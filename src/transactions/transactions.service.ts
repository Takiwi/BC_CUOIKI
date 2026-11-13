import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  DatabaseService,
  PoolClient,
  QueryResultRow,
} from '../database/database.service';
import { CreateReserveWithdrawalDto } from './dto/create-reserve-withdrawal.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { TransactionDecisionDto } from './dto/transaction-decision.dto';

function handleProcedureError(error: unknown): never {
  const err = error as { number?: number; message?: string };
  const message = err.message || 'Lỗi xử lý thủ tục cơ sở dữ liệu';
  if (err.number) {
    if ([50001, 50004, 50007, 50008, 50020].includes(err.number)) {
      throw new NotFoundException(message);
    }
    if ([50030, 50031].includes(err.number)) {
      throw new BadRequestException(message);
    }
    if (
      [50002, 50003, 50005, 50006, 50009, 50010, 50011, 50021, 50022].includes(
        err.number,
      )
    ) {
      throw new ConflictException(message);
    }
  }
  throw error;
}

export type TransactionType = 'PAYMENT' | 'RESERVE_WITHDRAWAL';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';
export type OverageStatus =
  'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TransactionView extends QueryResultRow {
  id: string;
  transactionType: TransactionType;
  proposalId: string | null;
  payableId: string | null;
  reserveWithdrawalId: string | null;
  proposalPurpose: string | null;
  requestedAmount: string;
  amount: string | null;
  note: string | null;
  status: TransactionStatus;
  rejectionReason: string | null;
  overageStatus: OverageStatus;
  overageDecisionReason: string | null;
  createdBy: string;
  creatorName: string;
  creatorIsActive: boolean;
  creatorStatusLabel: 'ACTIVE' | 'INACTIVE';
  completedBy: string | null;
  completedByName: string | null;
  completedByIsActive: boolean | null;
  completedByStatusLabel: 'ACTIVE' | 'INACTIVE' | null;
  createdAt: Date;
  completedAt: Date | null;
}

interface LockedTransaction extends QueryResultRow {
  id: string;
  transactionType: TransactionType;
  payableId: string | null;
  requestedAmount: string;
  amount: string | null;
  status: TransactionStatus;
  overageStatus: OverageStatus;
  note?: string | null;
}

interface LockedProposal extends QueryResultRow {
  creatorMemberId: string;
  amount: string;
  status: string;
}

interface LockedPayable extends QueryResultRow {
  id: string;
  proposalId: string;
  approvedAmount: string;
  balanceDue: string;
  status: 'OPEN' | 'PAID';
}

interface LockedReserveRequest extends QueryResultRow {
  id: string;
  requestedBy: string;
  amount: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
}

const transactionSelect = `
  SELECT t.id,
         t.transactionType,
         t.proposalId,
         t.payableId,
         t.reserveWithdrawalId,
         t.proposalPurpose,
         t.requestedAmount,
         t.amount,
         t.note,
         t.status,
         t.rejectionReason,
         t.overageStatus,
         t.overageDecisionReason,
         t.createdBy,
         t.creatorName,
         t.creatorIsActive,
         t.completedBy,
         t.completedByName,
         t.completedByIsActive,
         t.createdAt,
         t.completedAt
  FROM v_fund_transaction_details t
`;

const reserveRequestSelect = `
  SELECT r.id,
         r.requestedBy,
         r.requesterName,
         r.requesterIsActive,
         r.amount,
         r.reason,
         r.status,
         r.decidedBy,
         r.deciderName,
         r.decisionReason,
         r.executedBy,
         r.executorName,
         r.createdAt,
         r.decidedAt,
         r.executedAt
  FROM v_reserve_withdrawal_details r
`;

@Injectable()
export class TransactionsService {
  constructor(private readonly database: DatabaseService) {}

  async createProposalPayment(
    proposalId: string,
    input: CreateTransactionDto,
    actor: AuthenticatedUser,
    idempotencyKey: string,
  ): Promise<TransactionView> {
    validateMoney(input.amount);
    validateIdempotencyKey(idempotencyKey);
    let transactionId: string = randomUUID();
    await this.database.transaction(async (client) => {
      await lockIdempotencyKey(client, actor.id, idempotencyKey);

      const proposalResult = await client.query<LockedProposal>(
        `SELECT creator_member_id AS "creatorMemberId",
                CAST(amount AS NVARCHAR(50)) AS amount,
                status
         FROM spending_proposals WITH (UPDLOCK, ROWLOCK)
         WHERE id = $1`,
        [proposalId],
      );
      const proposal = proposalResult.rows[0];
      if (!proposal) throw new NotFoundException('Proposal not found');
      if (proposal.status !== 'APPROVED') {
        throw new ConflictException(
          'Only approved proposals can enter transaction processing',
        );
      }

      const payableResult = await client.query<LockedPayable>(
        `SELECT id,
                proposal_id AS "proposalId",
                CAST(approved_amount AS NVARCHAR(50)) AS "approvedAmount",
                CAST(balance_due AS NVARCHAR(50)) AS "balanceDue",
                status
         FROM payables WITH (UPDLOCK, ROWLOCK)
         WHERE proposal_id = $1`,
        [proposalId],
      );
      const payable = payableResult.rows[0];
      if (!payable) {
        throw new NotFoundException('Payable for this proposal not found');
      }
      if (payable.status !== 'OPEN') {
        throw new ConflictException('Payable is already fully paid');
      }

      const prior = await findIdempotentTransaction(
        client,
        actor.id,
        idempotencyKey,
      );
      if (prior) {
        assertSameRequest(
          prior,
          'PAYMENT',
          payable.id,
          input.amount,
          input.note,
        );
        transactionId = prior.id;
        return;
      }

      const pending = await client.query(
        `SELECT TOP (1) 1 FROM fund_transactions
         WHERE payable_id = $1 AND transaction_type = 'PAYMENT'
           AND status = 'PENDING'`,
        [payable.id],
      );
      if (pending.rowCount) {
        throw new ConflictException(
          'A payment transaction is already pending for this proposal',
        );
      }

      const overageStatus =
        compareDecimals(input.amount, payable.approvedAmount) > 0
          ? 'PENDING'
          : 'NOT_REQUIRED';
      await client.query(
        `INSERT INTO fund_transactions
           (id, transaction_type, payable_id, created_by,
            idempotency_key, requested_amount, note, overage_status)
         VALUES ($1, 'PAYMENT', $2, $3, $4, CAST($5 AS DECIMAL(18,2)), $6, $7)`,
        [
          transactionId,
          payable.id,
          actor.id,
          idempotencyKey,
          input.amount,
          input.note?.trim() || null,
          overageStatus,
        ],
      );
    });
    return this.getTransaction(transactionId);
  }

  async createDebtPayment(
    payableId: string,
    input: CreateTransactionDto,
    actor: AuthenticatedUser,
    idempotencyKey: string,
  ): Promise<TransactionView> {
    validateMoney(input.amount);
    validateIdempotencyKey(idempotencyKey);
    let transactionId: string = randomUUID();
    await this.database.transaction(async (client) => {
      await lockIdempotencyKey(client, actor.id, idempotencyKey);
      const prior = await findIdempotentTransaction(
        client,
        actor.id,
        idempotencyKey,
      );
      if (prior) {
        assertSameRequest(
          prior,
          'PAYMENT',
          payableId,
          input.amount,
          input.note,
        );
        transactionId = prior.id;
        return;
      }

      const payable = await lockPayable(client, payableId);
      if (payable.status !== 'OPEN') {
        throw new ConflictException('Payable is already fully paid');
      }
      if (compareDecimals(input.amount, payable.balanceDue) > 0) {
        throw new BadRequestException(
          'Payment amount cannot exceed the outstanding debt',
        );
      }
      await client.query(
        `INSERT INTO fund_transactions
           (id, transaction_type, payable_id, created_by,
            idempotency_key, requested_amount, note)
         VALUES ($1, 'PAYMENT', $2, $3, $4, CAST($5 AS DECIMAL(18,2)), $6)`,
        [
          transactionId,
          payableId,
          actor.id,
          idempotencyKey,
          input.amount,
          input.note?.trim() || null,
        ],
      );
    });
    return this.getTransaction(transactionId);
  }

  async decideOverage(
    transactionId: string,
    input: TransactionDecisionDto,
    reviewer: AuthenticatedUser,
  ): Promise<TransactionView> {
    if (reviewer.role !== 'BOARD') {
      throw new ForbiddenException(
        'Only Board members can decide proposal overages',
      );
    }
    if (input.decision === 'REJECTED' && !input.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required when rejecting an overage',
      );
    }
    await this.database.transaction(async (client) => {
      const transaction = await lockTransaction(client, transactionId);
      if (transaction.status !== 'PENDING') {
        throw new ConflictException(
          'Only pending transactions can receive overage decisions',
        );
      }
      if (transaction.overageStatus === 'NOT_REQUIRED') {
        throw new ConflictException(
          'This transaction does not have a proposal overage',
        );
      }
      if (transaction.overageStatus !== 'PENDING') {
        throw new ConflictException('No overage decision is pending');
      }
      await client.query(
        `UPDATE fund_transactions
         SET overage_status = $2,
             overage_decided_by = $3,
             overage_decision_reason = $4,
             overage_decided_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [
          transactionId,
          input.decision,
          reviewer.id,
          input.reason?.trim() || null,
        ],
      );
    });
    return this.getTransaction(transactionId);
  }

  async completeTransaction(
    transactionId: string,
    actor: AuthenticatedUser,
  ): Promise<TransactionView> {
    try {
      await this.database.executeProcedure('sp_complete_payment_transaction', {
        TransactionId: transactionId,
        ActorId: actor.id,
      });
    } catch (error) {
      handleProcedureError(error);
    }
    return this.getTransaction(transactionId);
  }

  async rejectTransaction(
    transactionId: string,
    input: RejectTransactionDto,
  ): Promise<TransactionView> {
    await this.database.transaction(async (client) => {
      const transaction = await lockTransaction(client, transactionId);
      if (transaction.status !== 'PENDING') {
        throw new ConflictException(
          'Only pending transactions can be rejected',
        );
      }
      await client.query(
        `UPDATE fund_transactions
         SET status = 'REJECTED', rejection_reason = $2
         WHERE id = $1`,
        [transactionId, input.reason.trim()],
      );
    });
    return this.getTransaction(transactionId);
  }

  async createReserveWithdrawal(
    input: CreateReserveWithdrawalDto,
    actor: AuthenticatedUser,
    idempotencyKey: string,
  ) {
    validateMoney(input.amount);
    validateIdempotencyKey(idempotencyKey);
    const requestId = randomUUID();
    await this.database.transaction(async (client) => {
      await lockIdempotencyKey(client, actor.id, idempotencyKey);
      const previous = await client.query<{
        id: string;
        amount: string;
        reason: string;
      }>(
        `SELECT id, CAST(amount AS NVARCHAR(50)) AS amount, reason
         FROM reserve_withdrawal_requests WITH (UPDLOCK, ROWLOCK)
         WHERE requested_by = $1 AND idempotency_key = $2`,
        [actor.id, idempotencyKey],
      );
      if (previous.rows[0]) {
        if (
          previous.rows[0].amount !== input.amount &&
          compareDecimals(previous.rows[0].amount, input.amount) !== 0
        ) {
          throw new ConflictException(
            'Idempotency-Key was already used for a different request',
          );
        }
        if (previous.rows[0].reason !== input.reason.trim()) {
          throw new ConflictException(
            'Idempotency-Key was already used for a different request',
          );
        }
        return;
      }
      await client.query(
        `INSERT INTO reserve_withdrawal_requests
           (id, requested_by, idempotency_key, amount, reason)
         VALUES ($1, $2, $3, CAST($4 AS DECIMAL(18,2)), $5)`,
        [
          requestId,
          actor.id,
          idempotencyKey,
          input.amount,
          input.reason.trim(),
        ],
      );
    });
    const result = await this.database.query<{ id: string }>(
      `SELECT id FROM reserve_withdrawal_requests
       WHERE requested_by = $1 AND idempotency_key = $2`,
      [actor.id, idempotencyKey],
    );
    return this.getReserveWithdrawal(result.rows[0].id);
  }

  async decideReserveWithdrawal(
    requestId: string,
    input: TransactionDecisionDto,
    reviewer: AuthenticatedUser,
  ) {
    if (reviewer.role !== 'BOARD') {
      throw new ForbiddenException(
        'Only Board members can approve reserve withdrawals',
      );
    }
    if (input.decision === 'REJECTED' && !input.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required when rejecting a reserve withdrawal',
      );
    }
    await this.database.transaction(async (client) => {
      const request = await lockReserveRequest(client, requestId);
      if (request.status !== 'PENDING') {
        throw new ConflictException(
          'Reserve withdrawal request is not awaiting a decision',
        );
      }
      await client.query(
        `UPDATE reserve_withdrawal_requests
         SET status = $2,
             decided_by = $3,
             decision_reason = $4,
             decided_at = SYSUTCDATETIME(),
             updated_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [requestId, input.decision, reviewer.id, input.reason?.trim() || null],
      );
    });
    return this.getReserveWithdrawal(requestId);
  }

  async completeReserveWithdrawal(
    requestId: string,
    executor: AuthenticatedUser,
  ) {
    try {
      await this.database.executeProcedure('sp_complete_reserve_withdrawal', {
        RequestId: requestId,
        ExecutorId: executor.id,
      });
    } catch (error) {
      handleProcedureError(error);
    }
    return this.getReserveWithdrawal(requestId);
  }

  async getTransactions(): Promise<TransactionView[]> {
    const result = await this.database.query<TransactionView>(
      `SELECT TOP (200)
              t.id,
              t.transactionType,
              t.proposalId,
              t.payableId,
              t.reserveWithdrawalId,
              t.proposalPurpose,
              t.requestedAmount,
              t.amount,
              t.note,
              t.status,
              t.rejectionReason,
              t.overageStatus,
              t.overageDecisionReason,
              t.createdBy,
              t.creatorName,
              t.creatorIsActive,
              t.completedBy,
              t.completedByName,
              t.completedByIsActive,
              t.createdAt,
              t.completedAt
       FROM v_fund_transaction_details t
       ORDER BY t.createdAt DESC, t.id`,
    );
    return result.rows.map(withActivityLabel);
  }

  async getDebts(actor: AuthenticatedUser, includePaidForOwner = false) {
    const values: unknown[] = [];
    let where = '';
    if (actor.role === 'MEMBER') {
      values.push(actor.id, includePaidForOwner ? 1 : 0);
      where =
        `WHERE p.creator_member_id = $1 ` + `AND ($2 = 1 OR d.status = 'OPEN')`;
    }
    const result = await this.database.query<{
      id: string;
      proposalId: string;
      purpose: string;
      eventId: string | null;
      eventName: string | null;
      creditorMemberId: string;
      creditorName: string;
      creditorIsActive: boolean;
      approvedAmount: string;
      amountDue: string;
      amountPaid: string;
      balanceDue: string;
      status: 'OPEN' | 'PAID';
      createdAt: Date;
      updatedAt: Date;
    }>(
      `SELECT TOP (200)
              d.id,
              d.proposal_id AS "proposalId",
              p.purpose,
              p.event_id AS "eventId",
              e.name AS "eventName",
              p.creator_member_id AS "creditorMemberId",
              creditor.full_name AS "creditorName",
              creditor.is_active AS "creditorIsActive",
              CAST(d.approved_amount AS NVARCHAR(50)) AS "approvedAmount",
              CAST(d.amount_due AS NVARCHAR(50)) AS "amountDue",
              CAST(d.amount_paid AS NVARCHAR(50)) AS "amountPaid",
              CAST(d.balance_due AS NVARCHAR(50)) AS "balanceDue",
              d.status,
              d.created_at AS "createdAt",
              d.updated_at AS "updatedAt"
       FROM payables d
       JOIN spending_proposals p ON p.id = d.proposal_id
       JOIN members creditor ON creditor.id = p.creator_member_id
       LEFT JOIN events e ON e.id = p.event_id
       ${where}
       ORDER BY d.created_at DESC, d.id`,
      values,
    );
    const debts = await Promise.all(
      result.rows.map(async (debt) => ({
        ...debt,
        creditorStatusLabel: debt.creditorIsActive ? 'ACTIVE' : 'INACTIVE',
        paymentHistory: await this.getPayableTransactions(debt.id),
      })),
    );
    return debts;
  }

  async getDebt(payableId: string, actor: AuthenticatedUser) {
    const debts = await this.getDebts(actor, true);
    const debt = debts.find((item) => item.id === payableId);
    if (!debt) throw new NotFoundException('Payable not found');
    return debt;
  }

  async getReserveWithdrawals() {
    const result = await this.database.query(
      `SELECT TOP (200)
              r.id,
              r.requestedBy,
              r.requesterName,
              r.requesterIsActive,
              r.amount,
              r.reason,
              r.status,
              r.decidedBy,
              r.deciderName,
              r.decisionReason,
              r.executedBy,
              r.executorName,
              r.createdAt,
              r.decidedAt,
              r.executedAt
       FROM v_reserve_withdrawal_details r
       ORDER BY r.createdAt DESC, r.id`,
    );
    return result.rows.map((request) => ({
      ...request,
      requesterStatusLabel: request.requesterIsActive ? 'ACTIVE' : 'INACTIVE',
    }));
  }

  private async getTransaction(id: string): Promise<TransactionView> {
    const result = await this.database.query<TransactionView>(
      `${transactionSelect} WHERE t.id = $1`,
      [id],
    );
    const transaction = result.rows[0];
    if (!transaction) throw new NotFoundException('Transaction not found');
    return withActivityLabel(transaction);
  }

  private async getReserveWithdrawal(id: string) {
    const result = await this.database.query(
      `${reserveRequestSelect} WHERE r.id = $1`,
      [id],
    );
    const request = result.rows[0];
    if (!request) {
      throw new NotFoundException('Reserve withdrawal request not found');
    }
    return {
      ...request,
      requesterStatusLabel: request.requesterIsActive ? 'ACTIVE' : 'INACTIVE',
    };
  }

  private async getPayableTransactions(payableId: string) {
    const result = await this.database.query<TransactionView>(
      `${transactionSelect}
       WHERE t.payableId = $1
       ORDER BY t.createdAt, t.id`,
      [payableId],
    );
    return result.rows.map(withActivityLabel);
  }
}

async function findIdempotentTransaction(
  client: PoolClient,
  createdBy: string,
  key: string,
): Promise<(LockedTransaction & { idempotencyKey: string }) | undefined> {
  const result = await client.query<
    LockedTransaction & {
      idempotencyKey: string;
    }
  >(
    `SELECT id,
            transaction_type AS "transactionType",
            payable_id AS "payableId",
            CAST(requested_amount AS NVARCHAR(50)) AS "requestedAmount",
            CAST(amount AS NVARCHAR(50)) AS amount,
            status,
            overage_status AS "overageStatus",
            note,
            idempotency_key AS "idempotencyKey"
     FROM fund_transactions WITH (UPDLOCK, ROWLOCK)
     WHERE created_by = $1 AND idempotency_key = $2`,
    [createdBy, key],
  );
  return result.rows[0];
}

function assertSameRequest(
  prior: LockedTransaction & {
    idempotencyKey: string;
  },
  type: 'PAYMENT',
  payableId: string,
  amount: string,
  note: string | undefined,
): void {
  const sameTarget = prior.payableId === payableId;
  if (
    prior.transactionType !== type ||
    !sameTarget ||
    compareDecimals(prior.requestedAmount, amount) !== 0 ||
    (prior.note ?? '') !== (note?.trim() ?? '')
  ) {
    throw new ConflictException(
      'Idempotency-Key was already used for a different transaction',
    );
  }
}

async function lockIdempotencyKey(
  client: PoolClient,
  actorId: string,
  key: string,
): Promise<void> {
  const resource = `idemp:${actorId}:${key}`;
  await client.query(
    `DECLARE @res INT;
     EXEC @res = sp_getapplock @Resource = $1, @LockMode = 'Exclusive', @LockOwner = 'Transaction';`,
    [resource],
  );
}

async function lockTransaction(
  client: PoolClient,
  id: string,
): Promise<LockedTransaction> {
  const result = await client.query<LockedTransaction>(
    `SELECT id,
            transaction_type AS "transactionType",
            payable_id AS "payableId",
            CAST(requested_amount AS NVARCHAR(50)) AS "requestedAmount",
            CAST(amount AS NVARCHAR(50)) AS amount,
            status,
            overage_status AS "overageStatus"
     FROM fund_transactions WITH (UPDLOCK, ROWLOCK)
     WHERE id = $1`,
    [id],
  );
  const transaction = result.rows[0];
  if (!transaction) throw new NotFoundException('Transaction not found');
  return transaction;
}

async function lockPayable(
  client: PoolClient,
  id: string,
): Promise<LockedPayable> {
  const result = await client.query<LockedPayable>(
    `SELECT id,
            proposal_id AS "proposalId",
            CAST(approved_amount AS NVARCHAR(50)) AS "approvedAmount",
            CAST(balance_due AS NVARCHAR(50)) AS "balanceDue",
            status
     FROM payables WITH (UPDLOCK, ROWLOCK)
     WHERE id = $1`,
    [id],
  );
  const payable = result.rows[0];
  if (!payable) throw new NotFoundException('Payable not found');
  return payable;
}

async function lockReserveRequest(
  client: PoolClient,
  id: string,
): Promise<LockedReserveRequest> {
  const result = await client.query<LockedReserveRequest>(
    `SELECT id,
            requested_by AS "requestedBy",
            CAST(amount AS NVARCHAR(50)) AS amount,
            reason,
            status
     FROM reserve_withdrawal_requests WITH (UPDLOCK, ROWLOCK)
     WHERE id = $1`,
    [id],
  );
  const request = result.rows[0];
  if (!request) {
    throw new NotFoundException('Reserve withdrawal request not found');
  }
  return request;
}

async function debitFund(
  client: PoolClient,
  fundType: 'MAIN' | 'RESERVE',
  amount: string,
): Promise<void> {
  const result = await client.query(
    `UPDATE funds
     SET balance = balance - CAST($1 AS DECIMAL(18,2)), updated_at = SYSUTCDATETIME()
     WHERE fund_type = $2 AND balance >= CAST($1 AS DECIMAL(18,2))`,
    [amount, fundType],
  );
  if (!result.rowCount) {
    throw new ConflictException(`Insufficient ${fundType} fund balance`);
  }
}

function withActivityLabel(transaction: TransactionView): TransactionView {
  return {
    ...transaction,
    creatorStatusLabel: transaction.creatorIsActive ? 'ACTIVE' : 'INACTIVE',
    completedByStatusLabel: transaction.completedBy
      ? transaction.completedByIsActive
        ? 'ACTIVE'
        : 'INACTIVE'
      : null,
  };
}

function validateMoney(value: string): void {
  if (!/^(?=.*[1-9])\d+(?:\.\d+)?$/.test(value)) {
    throw new BadRequestException('amount must be greater than zero');
  }
}

function validateIdempotencyKey(key: string): void {
  if (!key || key.trim().length < 8 || key.trim().length > 128) {
    throw new BadRequestException(
      'Idempotency-Key must contain between 8 and 128 characters',
    );
  }
}

function compareDecimals(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const leftMinor =
    BigInt(leftWhole) * factor + BigInt(leftFraction.padEnd(scale, '0') || '0');
  const rightMinor =
    BigInt(rightWhole) * factor +
    BigInt(rightFraction.padEnd(scale, '0') || '0');
  return leftMinor > rightMinor ? 1 : leftMinor < rightMinor ? -1 : 0;
}
