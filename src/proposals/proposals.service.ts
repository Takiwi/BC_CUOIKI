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
import { ApprovalDto } from '../members/dto/approval.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { VoteDto } from './dto/vote.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';

export type ProposalStatus =
  | 'VOTING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'TIE_REVIEW_REQUIRED'
  | 'BOARD_DECISION_REQUIRED';

export interface ProposalRecord extends QueryResultRow {
  id: string;
  creatorMemberId: string;
  creatorName: string;
  creatorRole: string;
  eventId: string | null;
  eventName: string | null;
  amount: string;
  purpose: string;
  note: string | null;
  status: ProposalStatus;
  reviewerMemberId: string | null;
  reviewerName: string | null;
  reviewDecision: 'APPROVED' | 'REJECTED' | null;
  reviewReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  currentRound: number;
  deadlineAt: Date;
  eligibleVoters: number;
  totalVotes: number;
}

interface LockedProposal extends QueryResultRow {
  id: string;
  creatorMemberId: string;
  eventId: string | null;
  amount: string;
  purpose: string;
  note: string | null;
  status: ProposalStatus;
}

interface VoteRound extends QueryResultRow {
  id: string;
  roundNumber: number;
  deadlineAt: Date;
  closedAt: Date | null;
}

interface VoteCounts extends QueryResultRow {
  eligibleVoters: number;
  totalVotes: number;
  yes: number;
  no: number;
  blank: number;
}

interface VoterRow extends QueryResultRow {
  memberId: string;
  fullName: string;
  role: string;
  isActive: boolean;
  choice: 'YES' | 'NO' | 'BLANK' | null;
}

export interface BallotResults {
  proposalId: string;
  round: number;
  startsAt: Date;
  deadlineAt: Date;
  closedAt: Date | null;
  eligibleVoters: number;
  eligibleVoterList: Array<{
    memberId: string;
    fullName: string;
    role: string;
    isActive: boolean;
    statusLabel: 'ACTIVE' | 'INACTIVE';
    choice: 'YES' | 'NO' | 'BLANK' | null;
  }>;
  totalVotes: number;
  yes: number;
  no: number;
  blank: number;
  proposalStatus: ProposalStatus;
  isQuorumReached: boolean;
  approvedPercent: number;
  nonVoters: Array<{
    memberId: string;
    fullName: string;
    statusLabel: 'ACTIVE' | 'INACTIVE';
  }>;
  roundResult: string | null;
}

interface FundBalanceRow extends QueryResultRow {
  fundType: 'MAIN' | 'RESERVE';
  balance: string;
}

interface BudgetRow extends QueryResultRow {
  totalBalance: string;
  approvedCommitments: string;
}

const proposalSelect = `
  SELECT p.id,
         p.creatorMemberId,
         p.creatorName,
         p.creatorRole,
         p.eventId,
         p.eventName,
         p.amount,
         p.purpose,
         p.note,
         p.status,
         p.reviewerMemberId,
         p.reviewerName,
         p.reviewDecision,
         p.reviewReason,
         p.reviewedAt,
         p.createdAt,
         p.updatedAt,
         p.currentRound,
         p.deadlineAt,
         p.eligibleVoters,
         p.totalVotes
  FROM v_spending_proposal_details p
`;

@Injectable()
export class ProposalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    input: CreateProposalDto,
    creator: AuthenticatedUser,
  ): Promise<ProposalRecord> {
    validateMoney(input.amount);
    const proposalId = randomUUID();
    const eventId = input.eventId ?? null;

    await this.database.transaction(async (client) => {
      await assertActiveMember(client, creator.id);
      if (eventId) {
        const event = await client.query('SELECT 1 FROM events WHERE id = $1', [
          eventId,
        ]);
        if (!event.rowCount) {
          throw new NotFoundException('Event not found');
        }
      }
      const balance = await lockFundBalances(client);
      if (compareDecimals(input.amount, balance.totalBalance) > 0) {
        throw new BadRequestException(
          'Proposal amount cannot exceed the current total fund balance',
        );
      }

      await client.query(
        `INSERT INTO spending_proposals
           (id, creator_member_id, event_id, amount, purpose, note)
         VALUES ($1, $2, $3, CAST($4 AS DECIMAL(18,2)), $5, $6)`,
        [
          proposalId,
          creator.id,
          eventId,
          input.amount,
          input.purpose.trim(),
          input.note?.trim() || null,
        ],
      );
      await createVoteRound(
        client,
        proposalId,
        eventId,
        creator.id,
        1,
        input.votingDeadline || input.deadline,
      );
    });

    const result = await this.findById(proposalId);
    // Thông báo cho tất cả người đủ điều kiện vote
    void this.notificationsService.notifyProposalCreated(
      proposalId,
      input.purpose.trim(),
      creator.id,
      eventId,
    );
    return result;
  }

  async findAll(filters: {
    status?: string | ProposalStatus;
    memberId?: string;
    eventId?: string;
  }): Promise<ProposalRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filters.status) {
      const rawStatuses =
        typeof filters.status === 'string'
          ? filters.status
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [filters.status];

      if (rawStatuses.length === 1) {
        values.push(rawStatuses[0]);
        clauses.push(`p.status = $${values.length}`);
      } else if (rawStatuses.length > 1) {
        const placeholders = rawStatuses.map((s) => {
          values.push(s);
          return `$${values.length}`;
        });
        clauses.push(`p.status IN (${placeholders.join(', ')})`);
      }
    }
    if (filters.memberId) {
      values.push(filters.memberId);
      clauses.push(`p.creatorMemberId = $${values.length}`);
    }
    if (filters.eventId) {
      values.push(filters.eventId);
      clauses.push(`p.eventId = $${values.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.database.query<ProposalRecord>(
      `${proposalSelect}
       ${where}
       ORDER BY p.createdAt DESC`,
      values,
    );
    return result.rows;
  }

  async findById(proposalId: string): Promise<ProposalRecord> {
    const result = await this.database.query<ProposalRecord>(
      `${proposalSelect}
       WHERE p.id = $1`,
      [proposalId],
    );
    const proposal = result.rows[0];
    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }
    return proposal;
  }

  async update(
    proposalId: string,
    input: UpdateProposalDto,
    actor: AuthenticatedUser,
  ): Promise<ProposalRecord> {
    await this.database.transaction(async (client) => {
      const proposal = await lockProposal(client, proposalId);
      assertCreator(proposal, actor);
      if (proposal.status !== 'VOTING') {
        throw new ConflictException('Only open proposals can be updated');
      }
      const round = await getCurrentRound(client, proposalId);
      if (!round || round.closedAt) {
        throw new ConflictException('Proposal voting is no longer open');
      }
      const votes = await client.query(
        'SELECT TOP (1) 1 FROM proposal_votes WHERE round_id = $1',
        [round.id],
      );
      if (votes.rowCount) {
        throw new ConflictException(
          'A proposal cannot be edited after a vote has been cast',
        );
      }
      const amount = input.amount ?? proposal.amount;
      validateMoney(amount);
      const balance = await lockFundBalances(client);
      if (compareDecimals(amount, balance.totalBalance) > 0) {
        throw new BadRequestException(
          'Proposal amount cannot exceed the current total fund balance',
        );
      }
      await client.query(
        `UPDATE spending_proposals
         SET amount = CAST($2 AS DECIMAL(18,2)),
             purpose = $3,
             note = $4,
             updated_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [
          proposalId,
          amount,
          input.purpose?.trim() ?? proposal.purpose,
          input.note === undefined ? proposal.note : input.note?.trim() || null,
        ],
      );
    });
    return this.findById(proposalId);
  }

  async cancel(
    proposalId: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; status: ProposalStatus }> {
    return this.database.transaction(async (client) => {
      const proposal = await lockProposal(client, proposalId);
      assertCreator(proposal, actor);
      if (!['VOTING', 'PENDING_APPROVAL'].includes(proposal.status)) {
        throw new ConflictException(
          'Only unapproved proposals can be cancelled',
        );
      }
      await client.query(
        `UPDATE spending_proposals
         SET status = 'CANCELLED', updated_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [proposalId],
      );
      const round = await getCurrentRound(client, proposalId);
      if (round && !round.closedAt) {
        await client.query(
          `UPDATE proposal_vote_rounds
           SET closed_at = SYSUTCDATETIME(), result = 'CANCELLED'
           WHERE id = $1`,
          [round.id],
        );
      }
      return { id: proposalId, status: 'CANCELLED' };
    });
  }

  async castVote(
    proposalId: string,
    input: VoteDto,
    voter: AuthenticatedUser,
  ): Promise<BallotResults> {
    return this.vote(proposalId, input, voter);
  }

  async approve(
    proposalId: string,
    input: ApprovalDto,
    reviewer: AuthenticatedUser,
  ): Promise<ProposalRecord> {
    return this.decide(proposalId, input, reviewer);
  }

  async vote(
    proposalId: string,
    input: VoteDto,
    voter: AuthenticatedUser,
  ): Promise<BallotResults> {
    return this.database.transaction(async (client) => {
      const proposal = await lockProposal(client, proposalId);
      if (proposal.status !== 'VOTING') {
        throw new ConflictException('Proposal is not accepting votes');
      }
      if (proposal.creatorMemberId === voter.id) {
        throw new ConflictException(
          'Proposal creator cannot vote on their own proposal',
        );
      }
      const round = await getCurrentRound(client, proposalId);
      if (!round || round.closedAt) {
        throw new ConflictException('Voting round is closed');
      }
      if (new Date(round.deadlineAt).getTime() <= Date.now()) {
        const counts = await getVoteCounts(client, round.id);
        await expireRound(client, proposalId, round.id, counts);
        throw new ConflictException('Voting deadline has passed');
      }

      if (proposal.eventId) {
        const eligible = await client.query(
          `SELECT 1
           FROM event_registrations r
           JOIN members m ON m.id = r.member_id
           WHERE r.event_id = $1
             AND r.member_id = $2
             AND r.status = 'ACTIVE'
             AND r.registered_at <= $3
             AND m.is_active = 1
             AND m.status = 'APPROVED'`,
          [proposal.eventId, voter.id, round.deadlineAt],
        );
        if (!eligible.rowCount) {
          throw new ForbiddenException(
            'You are not eligible to vote on this proposal',
          );
        }
      } else {
        const eligible = await client.query(
          `SELECT 1
           FROM members m
           WHERE m.id = $1
             AND m.is_active = 1
             AND m.status = 'APPROVED'
             AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
             AND m.created_at <= $2`,
          [voter.id, round.deadlineAt],
        );
        if (!eligible.rowCount) {
          throw new ForbiddenException(
            'You are not eligible to vote on this proposal',
          );
        }
      }

      const existingVote = await client.query(
        `SELECT 1
         FROM proposal_votes
         WHERE round_id = $1 AND member_id = $2`,
        [round.id, voter.id],
      );
      if (existingVote.rowCount) {
        throw new ConflictException(
          'You have already cast a vote for this round',
        );
      }

      await client.query(
        `INSERT INTO proposal_votes (round_id, member_id, choice)
         VALUES ($1, $2, $3)`,
        [round.id, voter.id, input.choice],
      );

      const counts = await getVoteCounts(client, round.id);
      if (counts.totalVotes === counts.eligibleVoters) {
        await resolveCompletedRound(
          client,
          proposalId,
          round.id,
          round.roundNumber,
          counts,
          proposal.eventId,
          proposal.creatorMemberId,
          this.notificationsService,
          proposal.purpose,
        );
      }

      return getBallotResults(client, proposalId);
    });
  }

  async getBallot(proposalId: string): Promise<BallotResults> {
    return this.database.transaction(async (client) => {
      const round = await getCurrentRound(client, proposalId);
      if (
        round &&
        !round.closedAt &&
        new Date(round.deadlineAt).getTime() <= Date.now() &&
        (await getVoteCounts(client, round.id)).totalVotes <
          (await getVoteCounts(client, round.id)).eligibleVoters
      ) {
        const counts = await getVoteCounts(client, round.id);
        await expireRound(client, proposalId, round.id, counts);
      }
      return getBallotResults(client, proposalId);
    });
  }

  async decide(
    proposalId: string,
    input: ApprovalDto,
    reviewer: AuthenticatedUser,
  ): Promise<ProposalRecord> {
    await this.database.transaction(async (client) => {
      const proposal = await lockProposal(client, proposalId);
      // 1. Chỉ Thủ quỹ, Ban chủ nhiệm hoặc Admin mới có quyền duyệt đề xuất chi
      if (!['TREASURER', 'BOARD', 'ADMIN'].includes(reviewer.role)) {
        throw new ForbiddenException(
          'Only Treasurer or Board members can approve or reject proposals',
        );
      }
      // 2. Chống tự duyệt: Người duyệt không được là người tạo đề xuất
      if (
        proposal.creatorMemberId === reviewer.id &&
        reviewer.role !== 'ADMIN'
      ) {
        throw new ForbiddenException(
          'Proposal creator cannot approve or reject their own proposal',
        );
      }
      // 3. Đề xuất do Thủ quỹ tạo bắt buộc phải do Ban chủ nhiệm (Board) duyệt
      const creatorRes = await client.query<{ role: string }>(
        'SELECT role FROM members WHERE id = $1',
        [proposal.creatorMemberId],
      );
      if (
        creatorRes.rows[0]?.role === 'TREASURER' &&
        reviewer.role === 'TREASURER'
      ) {
        throw new ForbiddenException(
          'Proposals created by Treasurer must be reviewed by the Board',
        );
      }
      if (proposal.status !== 'PENDING_APPROVAL') {
        throw new ConflictException('Proposal is not awaiting review');
      }
      if (input.decision === 'REJECTED' && !input.reason?.trim()) {
        throw new BadRequestException(
          'A reason is required when rejecting a proposal',
        );
      }
      const balance = await lockFundBalances(client);
      if (
        input.decision === 'APPROVED' &&
        compareDecimals(
          addDecimals(balance.approvedCommitments, proposal.amount),
          balance.totalBalance,
        ) > 0
      ) {
        throw new ConflictException(
          'Approved proposals would exceed the current total fund balance',
        );
      }
      await client.query(
        `UPDATE spending_proposals
         SET status = $2,
             reviewer_member_id = $3,
             review_decision = $2,
             review_reason = $4,
             reviewed_at = SYSUTCDATETIME(),
             updated_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [proposalId, input.decision, reviewer.id, input.reason?.trim() || null],
      );

      if (input.decision === 'APPROVED') {
        const payableId = randomUUID();
        await client.query(
          `INSERT INTO payables
             (id, proposal_id, approved_amount, amount_due, amount_paid, balance_due, status, created_at, updated_at)
           VALUES ($1, $2, CAST($3 AS DECIMAL(18,2)), CAST($3 AS DECIMAL(18,2)), 0, CAST($3 AS DECIMAL(18,2)), 'OPEN', SYSUTCDATETIME(), SYSUTCDATETIME())`,
          [payableId, proposalId, proposal.amount],
        );
      }
    });
    const result = await this.findById(proposalId);
    // Thông báo cho người tạo proposal
    void this.notificationsService.notifyProposalDecided(
      proposalId,
      result.purpose,
      result.creatorMemberId,
      input.decision,
      input.reason?.trim() || null,
    );
    return result;
  }

  async decideAfterTie(
    proposalId: string,
    input: ApprovalDto,
    reviewer: AuthenticatedUser,
  ): Promise<ProposalRecord> {
    await this.database.transaction(async (client) => {
      const proposal = await lockProposal(client, proposalId);
      if (reviewer.role !== 'BOARD') {
        throw new ForbiddenException(
          'Only Board members can decide a proposal after two tied rounds',
        );
      }
      if (proposal.status !== 'BOARD_DECISION_REQUIRED') {
        throw new ConflictException(
          'Proposal is not awaiting a Board decision',
        );
      }
      if (!input.reason?.trim()) {
        throw new BadRequestException(
          'A reason is required for the Board decision',
        );
      }
      const balance = await lockFundBalances(client);
      if (
        input.decision === 'APPROVED' &&
        compareDecimals(
          addDecimals(balance.approvedCommitments, proposal.amount),
          balance.totalBalance,
        ) > 0
      ) {
        throw new ConflictException(
          'Approved proposals would exceed the current total fund balance',
        );
      }
      await client.query(
        `UPDATE spending_proposals
         SET status = $2,
             reviewer_member_id = $3,
             review_decision = $2,
             review_reason = $4,
             reviewed_at = SYSUTCDATETIME(),
             updated_at = SYSUTCDATETIME()
         WHERE id = $1`,
        [proposalId, input.decision, reviewer.id, input.reason?.trim() || null],
      );

      if (input.decision === 'APPROVED') {
        const payableId = randomUUID();
        await client.query(
          `INSERT INTO payables
             (id, proposal_id, approved_amount, amount_due, amount_paid, balance_due, status, created_at, updated_at)
           VALUES ($1, $2, CAST($3 AS DECIMAL(18,2)), CAST($3 AS DECIMAL(18,2)), 0, CAST($3 AS DECIMAL(18,2)), 'OPEN', SYSUTCDATETIME(), SYSUTCDATETIME())`,
          [payableId, proposalId, proposal.amount],
        );
      }
    });
    const result = await this.findById(proposalId);
    // Thông báo cho người tạo proposal (quyết định cuối của Board)
    void this.notificationsService.notifyProposalDecided(
      proposalId,
      result.purpose,
      result.creatorMemberId,
      input.decision,
      input.reason?.trim() || null,
    );
    return result;
  }
}

async function assertActiveMember(
  client: PoolClient,
  memberId: string,
): Promise<void> {
  const result = await client.query<{ isActive: boolean; status: string }>(
    `SELECT m.is_active AS "isActive", m.status
     FROM members m
     WHERE m.id = $1`,
    [memberId],
  );
  if (!result.rows[0]?.isActive || result.rows[0].status !== 'APPROVED') {
    throw new ForbiddenException('Account is inactive or not approved');
  }
}

async function createVoteRound(
  client: PoolClient,
  proposalId: string,
  eventId: string | null,
  creatorId: string,
  roundNumber: 1 | 2,
  deadlineInput?: string,
): Promise<void> {
  const roundId = randomUUID();
  let deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  if (deadlineInput) {
    const parsed = new Date(deadlineInput);
    if (!isNaN(parsed.getTime()) && parsed > new Date()) {
      deadline = parsed;
    }
  }

  await client.query(
    `INSERT INTO proposal_vote_rounds (id, proposal_id, round_number, starts_at, deadline_at)
     VALUES ($1, $2, $3, SYSUTCDATETIME(), $4)`,
    [roundId, proposalId, roundNumber, deadline.toISOString()],
  );

  const counts = await getVoteCounts(client, roundId);
  if (counts.eligibleVoters === 0) {
    await client.query(
      `UPDATE proposal_vote_rounds
       SET closed_at = SYSUTCDATETIME(), result = 'REJECTED',
           yes_count = 0, no_count = 0, blank_count = 0
       WHERE id = $1`,
      [roundId],
    );
    await client.query(
      `UPDATE spending_proposals SET status = 'REJECTED', updated_at = SYSUTCDATETIME()
       WHERE id = $1`,
      [proposalId],
    );
  }
}

async function lockProposal(
  client: PoolClient,
  proposalId: string,
): Promise<LockedProposal> {
  const result = await client.query<LockedProposal>(
    `SELECT id,
            creator_member_id AS "creatorMemberId",
            event_id AS "eventId",
            CAST(amount AS NVARCHAR(50)) AS amount,
            purpose,
            note,
            status
     FROM spending_proposals WITH (UPDLOCK, ROWLOCK)
     WHERE id = $1`,
    [proposalId],
  );
  const proposal = result.rows[0];
  if (!proposal) {
    throw new NotFoundException('Proposal not found');
  }
  return proposal;
}

function assertCreator(
  proposal: LockedProposal,
  actor: AuthenticatedUser,
): void {
  if (proposal.creatorMemberId !== actor.id) {
    throw new ForbiddenException('Only the proposal creator can do this');
  }
}

async function getCurrentRound(
  client: PoolClient,
  proposalId: string,
): Promise<VoteRound | undefined> {
  const result = await client.query<VoteRound>(
    `SELECT TOP (1)
            id,
            round_number AS "roundNumber",
            deadline_at AS "deadlineAt",
            closed_at AS "closedAt"
     FROM proposal_vote_rounds WITH (UPDLOCK, ROWLOCK)
     WHERE proposal_id = $1
     ORDER BY round_number DESC`,
    [proposalId],
  );
  return result.rows[0];
}

async function getVoteCounts(
  client: PoolClient,
  roundId: string,
): Promise<VoteCounts> {
  const result = await client.query<{
    eligibleVoters: number;
    totalVotes: number;
    yes: number;
    no: number;
    blank: number;
  }>(
    `SELECT
       (
         SELECT COUNT(*)
         FROM (
           SELECT r.member_id
           FROM event_registrations r
           JOIN members m ON m.id = r.member_id
           WHERE p.event_id IS NOT NULL
             AND r.event_id = p.event_id
             AND r.status = 'ACTIVE'
             AND r.registered_at <= COALESCE(rd.closed_at, rd.deadline_at)
             AND m.is_active = 1
             AND m.status = 'APPROVED'
             AND r.member_id <> p.creator_member_id
           UNION ALL
           SELECT m.id
           FROM members m
           WHERE p.event_id IS NULL
             AND m.is_active = 1
             AND m.status = 'APPROVED'
             AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
             AND m.created_at <= COALESCE(rd.closed_at, rd.deadline_at)
             AND m.id <> p.creator_member_id
         ) e
       ) AS "eligibleVoters",
       COUNT(v.member_id) AS "totalVotes",
       COUNT(CASE WHEN v.choice = 'YES' THEN 1 END) AS yes,
       COUNT(CASE WHEN v.choice = 'NO' THEN 1 END) AS no,
       COUNT(CASE WHEN v.choice = 'BLANK' THEN 1 END) AS blank
     FROM proposal_vote_rounds rd
     JOIN spending_proposals p ON p.id = rd.proposal_id
     LEFT JOIN proposal_votes v ON v.round_id = rd.id
     WHERE rd.id = $1
     GROUP BY rd.id, rd.closed_at, rd.deadline_at, p.event_id, p.creator_member_id`,
    [roundId],
  );
  return {
    eligibleVoters: Number(result.rows[0]?.eligibleVoters ?? 0),
    totalVotes: Number(result.rows[0]?.totalVotes ?? 0),
    yes: Number(result.rows[0]?.yes ?? 0),
    no: Number(result.rows[0]?.no ?? 0),
    blank: Number(result.rows[0]?.blank ?? 0),
  };
}

async function resolveCompletedRound(
  client: PoolClient,
  proposalId: string,
  roundId: string,
  roundNumber: number,
  counts: VoteCounts,
  eventId: string | null,
  creatorId: string,
  notificationsService?: NotificationsService,
  purpose?: string,
): Promise<void> {
  const result =
    counts.eligibleVoters > 0 && counts.yes * 2 > counts.eligibleVoters
      ? 'PASSED'
      : counts.yes > 0 && counts.yes === counts.no
        ? roundNumber === 1
          ? 'TIED'
          : 'BOARD_DECISION_REQUIRED'
        : 'REJECTED';
  await client.query(
    `UPDATE proposal_vote_rounds
     SET closed_at = SYSUTCDATETIME(),
         result = $2,
         yes_count = $3,
         no_count = $4,
         blank_count = $5
     WHERE id = $1`,
    [roundId, result, counts.yes, counts.no, counts.blank],
  );
  const proposalStatus =
    result === 'PASSED'
      ? 'PENDING_APPROVAL'
      : result === 'BOARD_DECISION_REQUIRED'
        ? 'BOARD_DECISION_REQUIRED'
        : result === 'TIED'
          ? 'VOTING'
          : 'REJECTED';
  await client.query(
    `UPDATE spending_proposals
     SET status = $2, updated_at = SYSUTCDATETIME()
     WHERE id = $1`,
    [proposalId, proposalStatus],
  );
  if (result === 'TIED') {
    await createVoteRound(client, proposalId, eventId, creatorId, 2);
  }
  if (result === 'BOARD_DECISION_REQUIRED' && notificationsService && purpose) {
    void notificationsService.notifyBoardTieDecisionRequired(
      proposalId,
      purpose,
    );
  }
}

async function expireRound(
  client: PoolClient,
  proposalId: string,
  roundId: string,
  counts: VoteCounts,
): Promise<void> {
  const roundRes = await client.query<{
    deadlineAt: Date;
    eventId: string | null;
    creatorMemberId: string;
  }>(
    `SELECT rd.deadline_at AS "deadlineAt",
            p.event_id AS "eventId", p.creator_member_id AS "creatorMemberId"
     FROM proposal_vote_rounds rd
     JOIN spending_proposals p ON p.id = rd.proposal_id
     WHERE rd.id = $1`,
    [roundId],
  );
  const rd = roundRes.rows[0];

  if (rd) {
    if (rd.eventId) {
      await client.query(
        `INSERT INTO proposal_non_voters (round_id, member_id)
         SELECT $1, r.member_id
         FROM event_registrations r
         JOIN members m ON m.id = r.member_id
         LEFT JOIN proposal_votes v ON v.round_id = $1 AND v.member_id = r.member_id
         WHERE r.event_id = $2
           AND r.status = 'ACTIVE'
           AND r.registered_at <= $3
           AND m.is_active = 1
           AND m.status = 'APPROVED'
           AND r.member_id <> $4
           AND v.member_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM proposal_non_voters nv
             WHERE nv.round_id = $1 AND nv.member_id = r.member_id
           )`,
        [roundId, rd.eventId, rd.deadlineAt, rd.creatorMemberId],
      );
    } else {
      await client.query(
        `INSERT INTO proposal_non_voters (round_id, member_id)
         SELECT $1, m.id
         FROM members m
         LEFT JOIN proposal_votes v ON v.round_id = $1 AND v.member_id = m.id
         WHERE m.is_active = 1
           AND m.status = 'APPROVED'
           AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
           AND m.created_at <= $2
           AND m.id <> $3
           AND v.member_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM proposal_non_voters nv
             WHERE nv.round_id = $1 AND nv.member_id = m.id
           )`,
        [roundId, rd.deadlineAt, rd.creatorMemberId],
      );
    }
  }

  await client.query(
    `UPDATE proposal_vote_rounds
     SET closed_at = SYSUTCDATETIME(),
         result = 'INCOMPLETE',
         yes_count = $2,
         no_count = $3,
         blank_count = $4
     WHERE id = $1`,
    [roundId, counts.yes, counts.no, counts.blank],
  );
  await client.query(
    `UPDATE spending_proposals
     SET status = 'CANCELLED', updated_at = SYSUTCDATETIME()
     WHERE id = $1`,
    [proposalId],
  );
}

async function getBallotResults(
  client: PoolClient,
  proposalId: string,
): Promise<BallotResults> {
  const proposal = await client.query<{
    status: ProposalStatus;
    eventId: string | null;
    creatorMemberId: string;
    roundId: string;
    roundNumber: number;
    startsAt: Date;
    deadlineAt: Date;
    closedAt: Date | null;
    roundResult: string | null;
  }>(
    `SELECT TOP (1)
            p.status,
            p.event_id AS "eventId",
            p.creator_member_id AS "creatorMemberId",
            r.id AS "roundId",
            r.round_number AS "roundNumber",
            r.starts_at AS "startsAt",
            r.deadline_at AS "deadlineAt",
            r.closed_at AS "closedAt",
            r.result AS "roundResult"
     FROM spending_proposals p
     JOIN proposal_vote_rounds r ON r.proposal_id = p.id
     WHERE p.id = $1
     ORDER BY r.round_number DESC`,
    [proposalId],
  );
  const current = proposal.rows[0];
  if (!current) {
    throw new NotFoundException('Voting round not found');
  }
  const counts = await getVoteCounts(client, current.roundId);
  const eligible = current.eventId
    ? await client.query<VoterRow>(
        `SELECT m.id AS "memberId",
                m.full_name AS "fullName",
                m.role,
                m.is_active AS "isActive",
                v.choice
         FROM event_registrations r
         JOIN members m ON m.id = r.member_id
         LEFT JOIN proposal_votes v
           ON v.round_id = $1 AND v.member_id = m.id
         WHERE r.event_id = $2
           AND r.status = 'ACTIVE'
           AND r.registered_at <= $3
           AND m.is_active = 1
           AND m.status = 'APPROVED'
           AND r.member_id <> $4
         ORDER BY m.full_name, m.id`,
        [
          current.roundId,
          current.eventId,
          current.closedAt || current.deadlineAt,
          current.creatorMemberId,
        ],
      )
    : await client.query<VoterRow>(
        `SELECT m.id AS "memberId",
                m.full_name AS "fullName",
                m.role,
                m.is_active AS "isActive",
                v.choice
         FROM members m
         LEFT JOIN proposal_votes v
           ON v.round_id = $1 AND v.member_id = m.id
         WHERE m.is_active = 1
           AND m.status = 'APPROVED'
           AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
           AND m.created_at <= $2
           AND m.id <> $3
         ORDER BY m.full_name, m.id`,
        [
          current.roundId,
          current.closedAt || current.deadlineAt,
          current.creatorMemberId,
        ],
      );
  const nonVoters = await client.query<{
    memberId: string;
    fullName: string;
    statusLabel: 'ACTIVE' | 'INACTIVE';
  }>(
    `SELECT m.id AS "memberId",
            m.full_name AS "fullName",
            CASE WHEN m.is_active = 1 THEN 'ACTIVE' ELSE 'INACTIVE' END
              AS "statusLabel"
     FROM proposal_non_voters n
     JOIN members m ON m.id = n.member_id
     WHERE n.round_id = $1
     ORDER BY m.full_name, m.id`,
    [current.roundId],
  );
  return {
    proposalId,
    round: current.roundNumber,
    startsAt: current.startsAt,
    deadlineAt: current.deadlineAt,
    closedAt: current.closedAt,
    eligibleVoters: counts.eligibleVoters,
    eligibleVoterList: eligible.rows.map((row) => ({
      ...row,
      statusLabel: row.isActive ? 'ACTIVE' : 'INACTIVE',
    })),
    totalVotes: counts.totalVotes,
    yes: counts.yes,
    no: counts.no,
    blank: counts.blank,
    proposalStatus: current.status,
    isQuorumReached: counts.totalVotes === counts.eligibleVoters,
    approvedPercent:
      counts.eligibleVoters === 0
        ? 0
        : Number(((counts.yes / counts.eligibleVoters) * 100).toFixed(2)),
    nonVoters: nonVoters.rows,
    roundResult: current.roundResult,
  };
}

async function lockFundBalances(client: PoolClient): Promise<BudgetRow> {
  const funds = await client.query<FundBalanceRow>(
    `SELECT fund_type AS "fundType", CAST(balance AS NVARCHAR(50)) AS balance
     FROM funds WITH (UPDLOCK, ROWLOCK)
     WHERE fund_type IN ('MAIN', 'RESERVE')
     ORDER BY fund_type`,
  );
  if (funds.rows.length !== 2) {
    throw new ConflictException('Main and reserve funds must be initialized');
  }
  const budget = await client.query<BudgetRow>(
    `SELECT
       CAST(COALESCE((SELECT SUM(balance) FROM funds), 0) AS NVARCHAR(50)) AS "totalBalance",
       CAST(COALESCE((
         SELECT SUM(d.balance_due)
         FROM payables d
         WHERE d.status = 'OPEN'
       ), 0) AS NVARCHAR(50)) AS "approvedCommitments"`,
  );
  return budget.rows[0];
}

function validateMoney(amount: string): void {
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) {
    throw new BadRequestException('amount must be greater than zero');
  }
}

function compareDecimals(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const leftValue =
    BigInt(leftWhole) * factor + BigInt(leftFraction.padEnd(scale, '0') || '0');
  const rightValue =
    BigInt(rightWhole) * factor +
    BigInt(rightFraction.padEnd(scale, '0') || '0');
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function addDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const sum =
    BigInt(leftWhole) * factor +
    BigInt(leftFraction.padEnd(scale, '0') || '0') +
    BigInt(rightWhole) * factor +
    BigInt(rightFraction.padEnd(scale, '0') || '0');
  const fraction = (sum % factor)
    .toString()
    .padStart(scale, '0')
    .replace(/0+$/, '');
  return fraction ? `${sum / factor}.${fraction}` : (sum / factor).toString();
}
