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

interface ProposalResponse {
  id: string;
  creatorMemberId: string;
  amount: string;
  status: string;
  eligibleVoters: number;
  totalVotes: number;
}

interface BallotResponse {
  proposalId: string;
  round: number;
  eligibleVoters: number;
  eligibleVoterList: Array<{
    memberId: string;
    choice: 'YES' | 'NO' | 'BLANK' | null;
    statusLabel: 'ACTIVE' | 'INACTIVE';
  }>;
  totalVotes: number;
  yes: number;
  no: number;
  blank: number;
  proposalStatus: string;
  nonVoters: Array<{ memberId: string; statusLabel: string }>;
}

describe('Spending proposals and voting (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let initialBalances: { main: string; reserve: string };
  let president: TestUser;
  let board: TestUser;
  let treasurer: TestUser;
  let owner: TestUser;
  let voters: TestUser[];
  let externalVoters: TestUser[] = [];
  let inactive: TestUser;
  let eventId: string;
  const proposalIds: string[] = [];

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

    const initial = await database.query<{
      main: string;
      reserve: string;
    }>(
      `SELECT
         MAX(balance) FILTER (WHERE fund_type = 'MAIN')::text AS main,
         MAX(balance) FILTER (WHERE fund_type = 'RESERVE')::text AS reserve
       FROM funds`,
    );
    initialBalances = {
      main: initial.rows[0].main,
      reserve: initial.rows[0].reserve,
    };

    president = createUser('PRESIDENT');
    board = createUser('BOARD');
    treasurer = createUser('TREASURER');
    owner = createUser('MEMBER');
    voters = [createUser('MEMBER'), createUser('MEMBER'), createUser('MEMBER')];
    inactive = createUser('MEMBER');
    const users = [president, board, treasurer, owner, ...voters, inactive];
    await database.transaction(async (client) => {
      for (const user of users) {
        await client.query(
          `INSERT INTO members (id, full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'proposal-test-hash', $4)`,
          [user.id, `Proposal ${user.role}`, user.email, user.role],
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
      await client.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
        inactive.id,
      ]);
      eventId = randomUUID();
      await client.query(
        `INSERT INTO events
           (id, created_by, name, start_at, end_at, location)
         VALUES ($1, $2, 'Proposal voting event', NOW() + INTERVAL '1 day',
                 NOW() + INTERVAL '2 days', 'Test venue')`,
        [eventId, president.id],
      );
      for (const voter of voters.slice(0, 2)) {
        await client.query(
          `INSERT INTO event_registrations (event_id, member_id, status)
           VALUES ($1, $2, 'ACTIVE')`,
          [eventId, voter.id],
        );
      }
    });

    const jwt = app.get(JwtService);
    for (const user of users) {
      user.token = await jwt.signAsync({ sub: user.id, email: user.email });
    }
    const existingMembers = await database.query<{
      id: string;
      email: string;
      role: Role;
    }>(
      `SELECT m.id, m.email, m.role
       FROM members m
       JOIN membership_applications a ON a.member_id = m.id
       WHERE m.is_active = TRUE AND a.status = 'APPROVED'
         AND m.role IN ('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')`,
    );
    const fixtureIds = new Set(users.map((user) => user.id));
    externalVoters = await Promise.all(
      existingMembers.rows
        .filter((user) => !fixtureIds.has(user.id))
        .map(async (user) => ({
          ...user,
          token: await jwt.signAsync({ sub: user.id, email: user.email }),
        })),
    );
  });

  beforeEach(async () => {
    await database.transaction(async (client) => {
      await client.query(
        `UPDATE funds
         SET balance = CASE fund_type
               WHEN 'MAIN' THEN 2000
               WHEN 'RESERVE' THEN 0
             END,
             updated_at = NOW()`,
      );
      await client.query(
        'DELETE FROM event_registrations WHERE event_id = $1',
        [eventId],
      );
      for (const voter of voters.slice(0, 2)) {
        await client.query(
          `INSERT INTO event_registrations (event_id, member_id, status)
           VALUES ($1, $2, 'ACTIVE')`,
          [eventId, voter.id],
        );
      }
    });
  });

  afterEach(async () => {
    await cleanupProposals();
  });

  afterAll(async () => {
    await cleanupProposals();
    await database.transaction(async (client) => {
      await client.query(
        'DELETE FROM event_registrations WHERE event_id = $1',
        [eventId],
      );
      await client.query('DELETE FROM events WHERE id = $1', [eventId]);
      await client.query(
        `UPDATE funds
         SET balance = CASE fund_type
               WHEN 'MAIN' THEN $1::numeric
               WHEN 'RESERVE' THEN $2::numeric
             END,
             updated_at = NOW()`,
        [initialBalances.main, initialBalances.reserve],
      );
      const ids = [
        president.id,
        board.id,
        treasurer.id,
        owner.id,
        ...voters.map((voter) => voter.id),
        inactive.id,
      ];
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

  it('validates amount, create role, current balance and creator exclusion', async () => {
    await request(app.getHttpServer())
      .post('/funds/proposals')
      .send({ amount: '1', purpose: 'Guest proposal' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/funds/proposals')
      .set('Authorization', `Bearer ${board.token}`)
      .send({ amount: '1', purpose: 'Board proposal' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/funds/proposals')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ amount: '-1', purpose: 'Invalid amount' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/funds/proposals')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        amount: 1,
        purpose: 'JSON number rejected to preserve precision',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/funds/proposals')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ amount: '2000.01', purpose: 'Over balance' })
      .expect(400);

    const proposal = await createProposal(owner, '100');
    expect(proposal.status).toBe('VOTING');
    const ballot = await getBallot(proposal.id);
    expect(
      ballot.eligibleVoterList.map((voter) => voter.memberId),
    ).not.toContain(owner.id);
    expect(
      ballot.eligibleVoterList.map((voter) => voter.memberId),
    ).not.toContain(inactive.id);
  });

  it('snapshots only active event registrants and excludes proposal creator', async () => {
    const proposal = await createProposal(owner, '100', eventId);
    const ballot = await getBallot(proposal.id);
    expect(
      ballot.eligibleVoterList.map((voter) => voter.memberId).sort(),
    ).toEqual(
      voters
        .slice(0, 2)
        .map((voter) => voter.id)
        .sort(),
    );
    await vote(proposal.id, voters[2], 'YES', 403);
    const concurrentVotes = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/ballots/${proposal.id}/votes`)
          .set('Authorization', `Bearer ${voters[0].token}`)
          .send({ choice: 'YES' }),
      ),
    );
    expect(concurrentVotes.map((result) => result.status).sort()).toEqual([
      201, 409,
    ]);
  });

  it('keeps snapshot and an earlier vote after a voter becomes inactive', async () => {
    const proposal = await createProposal(owner, '100');
    await vote(proposal.id, voters[0], 'YES', 201);
    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      voters[0].id,
    ]);

    const result = await getBallot(proposal.id);
    expect(result.yes).toBe(1);
    expect(
      result.eligibleVoterList.find((voter) => voter.memberId === voters[0].id),
    ).toMatchObject({ choice: 'YES', statusLabel: 'INACTIVE' });
    await request(app.getHttpServer())
      .post(`/ballots/${proposal.id}/votes`)
      .set('Authorization', `Bearer ${voters[0].token}`)
      .send({ choice: 'NO' })
      .expect(403);
    await database.query('UPDATE members SET is_active = TRUE WHERE id = $1', [
      voters[0].id,
    ]);
  });

  it('closes early when all snapshot voters vote and accepts strictly more than 50 percent yes', async () => {
    const proposal = await createProposal(owner, '100');
    const result = await finishBallot(proposal.id, () => 'YES');
    expect(result.totalVotes).toBe(result.eligibleVoters);
    expect(result.proposalStatus).toBe('PENDING_APPROVAL');
    expect(result.yes * 2).toBeGreaterThan(result.eligibleVoters);
  });

  it('rejects at or below half except ties, which open a fresh second-round snapshot', async () => {
    const proposal = await createProposal(owner, '100');
    const outcome = await finishBallot(proposal.id, (index) =>
      index === 0 ? 'YES' : 'NO',
    );
    expect(outcome.proposalStatus).toBe('REJECTED');

    const tied = await createProposal(owner, '100', eventId);
    await vote(tied.id, voters[0], 'YES', 201);
    await database.query(
      `UPDATE event_registrations
       SET status = 'CANCELLED', cancelled_at = NOW()
       WHERE event_id = $1 AND member_id = $2`,
      [eventId, voters[1].id],
    );
    await database.query(
      `INSERT INTO event_registrations (event_id, member_id, status)
       VALUES ($1, $2, 'ACTIVE')`,
      [eventId, voters[2].id],
    );
    await vote(tied.id, voters[1], 'NO', 201);
    const firstRound = await getBallot(tied.id);
    expect(firstRound).toMatchObject({
      round: 2,
      proposalStatus: 'VOTING',
      totalVotes: 0,
      eligibleVoters: 2,
    });
    expect(
      firstRound.eligibleVoterList.map((voter) => voter.memberId).sort(),
    ).toEqual([voters[0].id, voters[2].id].sort());
    const passedSecondRound = await finishBallot(tied.id, () => 'YES');
    expect(passedSecondRound).toMatchObject({
      round: 2,
      proposalStatus: 'PENDING_APPROVAL',
    });

    const twiceTied = await createProposal(owner, '100');
    const afterRoundOne = await finishBallot(twiceTied.id, (index) =>
      index === 0 ? 'YES' : index === 1 ? 'NO' : 'BLANK',
    );
    expect(afterRoundOne).toMatchObject({
      round: 2,
      proposalStatus: 'VOTING',
    });
    const boardRequired = await finishBallot(twiceTied.id, (index) =>
      index === 0 ? 'YES' : index === 1 ? 'NO' : 'BLANK',
    );
    expect(boardRequired).toMatchObject({
      round: 2,
      proposalStatus: 'BOARD_DECISION_REQUIRED',
    });
    await request(app.getHttpServer())
      .patch(`/funds/proposals/${twiceTied.id}/board-decision`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ decision: 'APPROVED', reason: 'Not Board' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/funds/proposals/${twiceTied.id}/approve`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/funds/proposals/${twiceTied.id}/board-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(400);
    const boardDecision = await request(app.getHttpServer())
      .patch(`/funds/proposals/${twiceTied.id}/board-decision`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED', reason: 'Approved by Board' })
      .expect(200);
    expect(boardDecision.body.data).toMatchObject({
      status: 'APPROVED',
      reviewerMemberId: board.id,
      reviewReason: 'Approved by Board',
    });

    const blankOnly = await createProposal(owner, '100');
    const blankResult = await finishBallot(blankOnly.id, () => 'BLANK');
    expect(blankResult.proposalStatus).toBe('REJECTED');
  });

  it('cancels a ballot at timeout and persists all non-voters even after partial yes votes', async () => {
    const proposal = await createProposal(owner, '100');
    const ballot = await getBallot(proposal.id);
    const lastVoterId =
      ballot.eligibleVoterList[ballot.eligibleVoterList.length - 1]?.memberId;
    if (!lastVoterId) throw new Error('Expected an eligible voter in snapshot');
    for (const eligible of ballot.eligibleVoterList) {
      if (eligible.memberId === lastVoterId) continue;
      await vote(proposal.id, findTestUser(eligible.memberId), 'YES', 201);
    }
    await database.query(
      `UPDATE proposal_vote_rounds
       SET starts_at = NOW() - INTERVAL '2 days',
           deadline_at = NOW() - INTERVAL '1 second'
       WHERE proposal_id = $1`,
      [proposal.id],
    );
    const expired = await request(app.getHttpServer())
      .get(`/ballots/${proposal.id}/results`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(expired.body.data.proposalStatus).toBe('CANCELLED');
    expect(expired.body.data.nonVoters).toHaveLength(1);
    expect(expired.body.data.yes).toBe(expired.body.data.eligibleVoters - 1);
    const persisted = await database.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM proposal_non_voters n
       JOIN proposal_vote_rounds r ON r.id = n.round_id
       WHERE r.proposal_id = $1`,
      [proposal.id],
    );
    expect(persisted.rows[0].count).toBe(1);
    await vote(proposal.id, findTestUser(lastVoterId), 'YES', 409);
  });

  it('requires Board to review a Treasurer-created proposal and records authenticated reviewer', async () => {
    const proposal = await createProposal(treasurer, '100');
    const ballot = await finishBallot(proposal.id, () => 'YES');
    expect(ballot.proposalStatus).toBe('PENDING_APPROVAL');

    await request(app.getHttpServer())
      .patch(`/funds/proposals/${proposal.id}/approve`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    const approved = await request(app.getHttpServer())
      .patch(`/funds/proposals/${proposal.id}/approve`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      reviewerMemberId: board.id,
      reviewDecision: 'APPROVED',
    });
  });

  it('serializes concurrent approvals so approved commitments never exceed total funds', async () => {
    const first = await createProposal(owner, '1500');
    const second = await createProposal(voters[0], '1500');
    await finishBallot(first.id, () => 'YES');
    await finishBallot(second.id, () => 'YES');

    const responses = await Promise.all([
      request(app.getHttpServer())
        .patch(`/funds/proposals/${first.id}/approve`)
        .set('Authorization', `Bearer ${treasurer.token}`)
        .send({ decision: 'APPROVED' }),
      request(app.getHttpServer())
        .patch(`/funds/proposals/${second.id}/approve`)
        .set('Authorization', `Bearer ${board.token}`)
        .send({ decision: 'APPROVED' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const approved = await database.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM spending_proposals WHERE status = 'APPROVED'`,
    );
    expect(Number(approved.rows[0].total)).toBeLessThanOrEqual(2000);
  });

  it('only lets the creator edit before any vote and cancel while unapproved', async () => {
    const proposal = await createProposal(owner, '100');
    await request(app.getHttpServer())
      .patch(`/funds/proposals/${proposal.id}`)
      .set('Authorization', `Bearer ${voters[0].token}`)
      .send({ purpose: 'Unauthorized edit' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/funds/proposals/${proposal.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ amount: '150', purpose: 'Revised purpose' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.amount).toBe('150');
        expect(body.data.purpose).toBe('Revised purpose');
      });
    await request(app.getHttpServer())
      .delete(`/funds/proposals/${proposal.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('CANCELLED'));
  });

  async function createProposal(
    creator: TestUser,
    amount: string,
    attachedEventId?: string,
  ): Promise<ProposalResponse> {
    const response = await request(app.getHttpServer())
      .post('/funds/proposals')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        amount,
        purpose: 'Proposal integration test',
        ...(attachedEventId ? { eventId: attachedEventId } : {}),
      })
      .expect(201);
    proposalIds.push(response.body.data.id as string);
    return response.body.data as ProposalResponse;
  }

  async function getBallot(proposalId: string): Promise<BallotResponse> {
    const response = await request(app.getHttpServer())
      .get(`/ballots/${proposalId}/results`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    return response.body.data as BallotResponse;
  }

  async function vote(
    proposalId: string,
    voter: TestUser,
    choice: 'YES' | 'NO' | 'BLANK',
    expectedStatus: number,
  ) {
    return request(app.getHttpServer())
      .post(`/ballots/${proposalId}/votes`)
      .set('Authorization', `Bearer ${voter.token}`)
      .send({ choice })
      .expect(expectedStatus);
  }

  async function finishBallot(
    proposalId: string,
    choiceFor: (index: number) => 'YES' | 'NO' | 'BLANK',
  ): Promise<BallotResponse> {
    const initial = await getBallot(proposalId);
    for (const [index, snapshotVoter] of initial.eligibleVoterList.entries()) {
      const user = findTestUser(snapshotVoter.memberId);
      await vote(proposalId, user, choiceFor(index), 201);
    }
    return getBallot(proposalId);
  }

  function findTestUser(memberId: string): TestUser {
    const user = [
      president,
      board,
      treasurer,
      owner,
      ...voters,
      inactive,
      ...externalVoters,
    ].find((candidate) => candidate.id === memberId);
    if (!user) throw new Error('Snapshot references an unknown test voter');
    return user;
  }

  async function cleanupProposals(): Promise<void> {
    const creators = [
      president.id,
      board.id,
      treasurer.id,
      owner.id,
      ...voters.map((voter) => voter.id),
    ];
    const found = await database.query<{ id: string }>(
      `SELECT id
       FROM spending_proposals
       WHERE creator_member_id = ANY($1::uuid[]) OR event_id = $2`,
      [creators, eventId],
    );
    const ids = [
      ...new Set([...proposalIds, ...found.rows.map((row) => row.id)]),
    ];
    if (!ids.length) return;
    await database.transaction(async (client) => {
      await client.query(
        `DELETE FROM proposal_non_voters n
         USING proposal_vote_rounds r
         WHERE n.round_id = r.id AND r.proposal_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM proposal_votes v
         USING proposal_vote_rounds r
         WHERE v.round_id = r.id AND r.proposal_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM proposal_voter_snapshots s
         USING proposal_vote_rounds r
         WHERE s.round_id = r.id AND r.proposal_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        'DELETE FROM proposal_vote_rounds WHERE proposal_id = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM spending_proposals WHERE id = ANY($1::uuid[])',
        [ids],
      );
    });
    proposalIds.length = 0;
  }
});

function createUser(role: Role): TestUser {
  const id = randomUUID();
  return {
    id,
    role,
    email: `proposal-${role.toLowerCase()}-${id}@test.invalid`,
    token: '',
  };
}
