import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { DatabaseService } from '../src/database/database.service';

type Role = 'PRESIDENT' | 'BOARD' | 'TREASURER' | 'MEMBER';

interface TestUser {
  id: string;
  role: Role;
  email: string;
  token: string;
}

interface FinanceState {
  main: string;
  reserve: string;
}

describe('Transactions, payables and reserve withdrawals (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let initialState: FinanceState;
  let board: TestUser;
  let treasurer: TestUser;
  let president: TestUser;
  let member: TestUser;
  let inactive: TestUser;
  const proposalIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-only-secret-that-is-long-enough-0001';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    database = app.get(DatabaseService);
    await app.init();

    const state = await database.query<{
      main: string;
      reserve: string;
    }>(
      `SELECT
         (SELECT balance::text FROM funds WHERE fund_type = 'MAIN') AS main,
         (SELECT balance::text FROM funds WHERE fund_type = 'RESERVE') AS reserve`,
    );
    initialState = state.rows[0];
    board = createUser('BOARD');
    treasurer = createUser('TREASURER');
    president = createUser('PRESIDENT');
    member = createUser('MEMBER');
    inactive = createUser('MEMBER');
    const users = [board, treasurer, president, member, inactive];
    await database.transaction(async (client) => {
      for (const user of users) {
        await client.query(
          `INSERT INTO members (id, full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'finance-test-hash', $4)`,
          [user.id, `Finance ${user.role}`, user.email, user.role],
        );
      }
      for (const user of users) {
        await client.query(
          `INSERT INTO membership_applications
             (id, member_id, status, decided_by, decided_at)
           VALUES ($1, $2, 'APPROVED', $3, NOW())`,
          [randomUUID(), user.id, president.id],
        );
      }
    });
    const jwt = app.get(JwtService);
    for (const user of users) {
      user.token = await jwt.signAsync({ sub: user.id, email: user.email });
    }
  });

  beforeEach(async () => {
    await cleanupFixtures();
    await setBalances('1000', '400');
    await database.query('UPDATE members SET is_active = TRUE WHERE id = $1', [
      inactive.id,
    ]);
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await setBalances(initialState.main, initialState.reserve);
    const ids = [board.id, treasurer.id, president.id, member.id, inactive.id];
    await database.transaction(async (client) => {
      await client.query(
        'DELETE FROM membership_applications WHERE member_id = ANY($1::uuid[])',
        [ids],
      );
      await client.query('DELETE FROM members WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
    });
    await app.close();
  });

  it('keeps PENDING and REJECTED transactions from changing funds', async () => {
    const proposalId = await createApprovedProposal('100');
    const pending = await createPayment(proposalId, '60', 'pending-payment');
    expect(pending.body.data.status).toBe('PENDING');
    expect(await balance('MAIN')).toBe('1000');

    await request(app.getHttpServer())
      .patch(`/funds/transactions/${pending.body.data.id}/reject`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({})
      .expect(400);
    const rejected = await request(app.getHttpServer())
      .patch(`/funds/transactions/${pending.body.data.id}/reject`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ reason: 'Invoice was withdrawn' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Invoice was withdrawn',
    });
    expect(await balance('MAIN')).toBe('1000');
    await request(app.getHttpServer())
      .post(`/funds/transactions/${pending.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(409);
  });

  it('completes an approved payment exactly once and enforces idempotency', async () => {
    const proposalId = await createApprovedProposal('100');
    const key = 'payment-once-001';
    const [first, retry] = await Promise.all([
      createPayment(proposalId, '100', key),
      createPayment(proposalId, '100', key),
    ]);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await balance('MAIN')).toBe('1000');

    const completed = await request(app.getHttpServer())
      .post(`/funds/transactions/${first.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    expect(completed.body.data).toMatchObject({
      status: 'COMPLETED',
      amount: '100',
    });
    expect(await balance('MAIN')).toBe('900');
    await request(app.getHttpServer())
      .post(`/funds/transactions/${first.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(409);
    expect(await balance('MAIN')).toBe('900');
    expect(completed.body.data.payableId).toBeTruthy();
  });

  it('does not create a transaction before proposal approval', async () => {
    const proposalId = randomUUID();
    proposalIds.push(proposalId);
    await database.query(
      `INSERT INTO spending_proposals
         (id, creator_member_id, amount, purpose, status)
       VALUES ($1, $2, 100, 'Waiting proposal', 'PENDING_APPROVAL')`,
      [proposalId, member.id],
    );
    await request(app.getHttpServer())
      .post(`/funds/proposals/${proposalId}/transactions`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', 'unapproved-proposal-001')
      .send({ amount: '50' })
      .expect(409);
    expect(await balance('MAIN')).toBe('1000');
  });

  it('requires Board overage approval and records rejected excess as debt', async () => {
    const proposalId = await createApprovedProposal('100');
    const transaction = await createPayment(
      proposalId,
      '150',
      'payment-overage-001',
    );
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${transaction.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${transaction.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'REJECTED' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${transaction.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'REJECTED', reason: 'Excess not authorized' })
      .expect(200);

    const completed = await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    expect(completed.body.data.amount).toBe('100');
    expect(completed.body.data.overageStatus).toBe('REJECTED');
    expect(await balance('MAIN')).toBe('900');

    const payableId = completed.body.data.payableId as string;
    const debts = await request(app.getHttpServer())
      .get('/funds/debts')
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(debts.body.data).toHaveLength(1);
    expect(debts.body.data[0]).toMatchObject({
      id: payableId,
      amountDue: '150',
      amountPaid: '100',
      balanceDue: '50',
      status: 'OPEN',
      creditorMemberId: member.id,
    });
  });

  it('records completed event costs through proposal, payable and transaction', async () => {
    const eventId = randomUUID();
    const eventName = `Finance event ${eventId}`;
    eventIds.push(eventId);
    await database.query(
      `INSERT INTO events (id, created_by, name, start_at, end_at, location)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day',
                 NOW() + INTERVAL '2 days', 'Test venue')`,
      [eventId, president.id, eventName],
    );
    const proposalId = await createApprovedProposal('45', member.id, eventId);
    const transaction = await createPayment(
      proposalId,
      '45',
      'payment-event-001',
    );
    await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    const report = await request(app.getHttpServer())
      .get('/funds/reports')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(report.body.data.eventExpenses).toContainEqual(
      expect.objectContaining({
        eventId,
        eventName,
        totalExpense: '45',
        transactionCount: 1,
      }),
    );
  });

  it('allows Board-approved overage and rejects actual non-positive amounts', async () => {
    const proposalId = await createApprovedProposal('100');
    await request(app.getHttpServer())
      .post(`/funds/proposals/${proposalId}/transactions`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', 'payment-zero-001')
      .send({ amount: '0' })
      .expect(400);
    const transaction = await createPayment(
      proposalId,
      '150',
      'payment-overage-002',
    );
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${transaction.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${board.token}`)
      .expect(201);
    expect(completed.body.data.amount).toBe('150');
    expect(await balance('MAIN')).toBe('850');
    expect(completed.body.data.overageStatus).toBe('APPROVED');
  });

  it('supports partial and final debt payments and preserves PAID history', async () => {
    const proposalId = await createApprovedProposal('100');
    const initial = await createPayment(proposalId, '150', 'payment-debt-001');
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${initial.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'REJECTED', reason: 'Use approved amount only' })
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post(`/funds/transactions/${initial.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    const payableId = completed.body.data.payableId as string;

    const partial = await createDebtPayment(payableId, '20', 'debt-part-001');
    await request(app.getHttpServer())
      .post(`/funds/transactions/${partial.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    const finalPayment = await createDebtPayment(
      payableId,
      '30',
      'debt-final-001',
    );
    await request(app.getHttpServer())
      .post(`/funds/transactions/${finalPayment.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/funds/debts/${payableId}`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      status: 'PAID',
      amountDue: '150',
      amountPaid: '150',
      balanceDue: '0',
    });
    expect(detail.body.data.paymentHistory).toHaveLength(3);
    expect(await balance('MAIN')).toBe('850');
    await request(app.getHttpServer())
      .get(`/funds/debts/${payableId}`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    const otherMember = await request(app.getHttpServer())
      .get('/funds/debts')
      .set('Authorization', `Bearer ${inactive.token}`)
      .expect(200);
    expect(otherMember.body.data).toHaveLength(0);
  });

  it('requires Board approval for reserve use and permits Treasurer or Board execution', async () => {
    const requestKey = 'reserve-request-001';
    await request(app.getHttpServer())
      .post('/funds/withdraw-reserve')
      .set('Authorization', `Bearer ${board.token}`)
      .set('Idempotency-Key', 'board-reserve-request-001')
      .send({ amount: '10', reason: 'Board cannot submit this request' })
      .expect(403);
    const response = await request(app.getHttpServer())
      .post('/funds/withdraw-reserve')
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', requestKey)
      .send({ amount: '80', reason: 'Equipment repair' })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post('/funds/withdraw-reserve')
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', requestKey)
      .send({ amount: '80', reason: 'Equipment repair' })
      .expect(201);
    expect(retry.body.data.id).toBe(response.body.data.id);
    expect(await balance('RESERVE')).toBe('400');
    await request(app.getHttpServer())
      .patch(`/funds/reserve-withdrawals/${response.body.data.id}/decision`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/funds/reserve-withdrawals/${response.body.data.id}/decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post(`/funds/reserve-withdrawals/${response.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.executorName).toContain('TREASURER');
    expect(await balance('RESERVE')).toBe('320');
    await request(app.getHttpServer())
      .post(`/funds/reserve-withdrawals/${response.body.data.id}/complete`)
      .set('Authorization', `Bearer ${board.token}`)
      .expect(409);
    expect(await balance('RESERVE')).toBe('320');

    const boardExecutionRequest = await createReserveRequest(
      '20',
      'reserve-board-exec-001',
    );
    await request(app.getHttpServer())
      .patch(`/funds/reserve-withdrawals/${boardExecutionRequest.id}/decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    const boardExecuted = await request(app.getHttpServer())
      .post(`/funds/reserve-withdrawals/${boardExecutionRequest.id}/complete`)
      .set('Authorization', `Bearer ${board.token}`)
      .expect(201);
    expect(boardExecuted.body.data.executorName).toContain('BOARD');
    expect(await balance('RESERVE')).toBe('300');
  });

  it('records reserve rejection reasons, prevents negative balances, and blocks inactive operators', async () => {
    const rejectedRequest = await createReserveRequest(
      '500',
      'reserve-rej-001',
    );
    await request(app.getHttpServer())
      .patch(`/funds/reserve-withdrawals/${rejectedRequest.id}/decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'REJECTED', reason: 'Insufficient justification' })
      .expect(200);
    expect(await balance('RESERVE')).toBe('400');

    const approvedRequest = await createReserveRequest(
      '500',
      'reserve-low-001',
    );
    await request(app.getHttpServer())
      .patch(`/funds/reserve-withdrawals/${approvedRequest.id}/decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/funds/reserve-withdrawals/${approvedRequest.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(409);
    expect(await balance('RESERVE')).toBe('400');

    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      treasurer.id,
    ]);
    await request(app.getHttpServer())
      .post('/funds/withdraw-reserve')
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', 'inactive-reserve-001')
      .send({ amount: '10', reason: 'Inactive account test' })
      .expect(403);
    await database.query('UPDATE members SET is_active = TRUE WHERE id = $1', [
      treasurer.id,
    ]);
  });

  it('restricts debt visibility to the creditor and retains inactive creditor labels', async () => {
    const proposalId = await createApprovedProposal('100', inactive.id);
    const transaction = await createPayment(
      proposalId,
      '150',
      'inactive-debt-001',
    );
    await request(app.getHttpServer())
      .patch(`/funds/transactions/${transaction.body.data.id}/overage-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'REJECTED', reason: 'No excess approval' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      inactive.id,
    ]);
    const allDebts = await request(app.getHttpServer())
      .get('/funds/debts')
      .set('Authorization', `Bearer ${board.token}`)
      .expect(200);
    expect(allDebts.body.data[0]).toMatchObject({
      creditorMemberId: inactive.id,
      creditorStatusLabel: 'INACTIVE',
      status: 'OPEN',
    });
  });

  it('prevents expense beyond available main balance and counts completed spend in reports', async () => {
    const proposalId = await createApprovedProposal('100');
    const transaction = await createPayment(
      proposalId,
      '100',
      'payment-insufficient-001',
    );
    await setBalances('50', '400');
    await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(409);
    expect(await balance('MAIN')).toBe('50');
    await setBalances('100', '400');
    await request(app.getHttpServer())
      .post(`/funds/transactions/${transaction.body.data.id}/complete`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(201);
    const report = await request(app.getHttpServer())
      .get('/funds/reports')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    const expenses = await database.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM fund_transactions WHERE status = 'COMPLETED'`,
    );
    expect(report.body.data.totalExpense).toBe(expenses.rows[0].total);
    expect(report.body.data.eventExpenses).toEqual([]);
  });

  async function createApprovedProposal(
    amount: string,
    creatorId = member.id,
    eventId?: string,
  ): Promise<string> {
    const proposalId = randomUUID();
    proposalIds.push(proposalId);
    await database.query(
      `INSERT INTO spending_proposals
         (id, creator_member_id, event_id, amount, purpose, status,
          reviewer_member_id, review_decision, reviewed_at)
       VALUES ($1, $2, $3, $4::numeric, 'Transaction integration proposal',
               'APPROVED', $5, 'APPROVED', NOW())`,
      [proposalId, creatorId, eventId ?? null, amount, board.id],
    );
    return proposalId;
  }

  async function createPayment(
    proposalId: string,
    amount: string,
    key: string,
  ) {
    return request(app.getHttpServer())
      .post(`/funds/proposals/${proposalId}/transactions`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', key)
      .send({ amount })
      .expect(201);
  }

  async function createDebtPayment(
    payableId: string,
    amount: string,
    key: string,
  ) {
    return request(app.getHttpServer())
      .post(`/funds/debts/${payableId}/payments`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', key)
      .send({ amount })
      .expect(201);
  }

  async function createReserveRequest(amount: string, key: string) {
    const response = await request(app.getHttpServer())
      .post('/funds/withdraw-reserve')
      .set('Authorization', `Bearer ${treasurer.token}`)
      .set('Idempotency-Key', key)
      .send({ amount, reason: 'Reserve withdrawal test' })
      .expect(201);
    return response.body.data as { id: string };
  }

  async function balance(type: 'MAIN' | 'RESERVE'): Promise<string> {
    const result = await database.query<{ balance: string }>(
      'SELECT balance::text AS balance FROM funds WHERE fund_type = $1',
      [type],
    );
    return result.rows[0].balance;
  }

  async function setBalances(main: string, reserve: string): Promise<void> {
    await database.query(
      `UPDATE funds
       SET balance = CASE fund_type
             WHEN 'MAIN' THEN $1::numeric
             WHEN 'RESERVE' THEN $2::numeric
           END,
           updated_at = NOW()`,
      [main, reserve],
    );
  }

  async function cleanupFixtures(): Promise<void> {
    const ids = [...new Set(proposalIds)];
    await database.transaction(async (client) => {
      await client.query(
        `DELETE FROM fund_transactions
         WHERE proposal_id = ANY($1::uuid[])
            OR payable_id IN (SELECT id FROM payables
                              WHERE proposal_id = ANY($1::uuid[]))
            OR created_by = ANY($2::uuid[])`,
        [ids, [board.id, treasurer.id, president.id, member.id, inactive.id]],
      );
      await client.query(
        `DELETE FROM payables WHERE proposal_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM reserve_withdrawal_requests WHERE requested_by = ANY($1::uuid[])`,
        [[board.id, treasurer.id, president.id, member.id, inactive.id]],
      );
      if (ids.length) {
        await client.query(
          'DELETE FROM spending_proposals WHERE id = ANY($1::uuid[])',
          [ids],
        );
      }
      if (eventIds.length) {
        await client.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [
          eventIds,
        ]);
      }
    });
    proposalIds.length = 0;
    eventIds.length = 0;
  }
});

function createUser(role: Role): TestUser {
  const id = randomUUID();
  return {
    id,
    role,
    email: `transactions-${role.toLowerCase()}-${id}@test.invalid`,
    token: '',
  };
}
