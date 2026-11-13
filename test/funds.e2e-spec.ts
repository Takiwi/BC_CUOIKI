import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { DatabaseService } from '../src/database/database.service';
import { AppModule } from '../src/app.module';

interface TestUser {
  id: string;
  role: 'PRESIDENT' | 'MEMBER';
  email: string;
  token: string;
}

interface ContributionData {
  id: string;
  amount: string;
  mainAllocated: string;
  reserveAllocated: string;
  donorMemberId: string | null;
  balances: {
    mainFund: string;
    reserveFund: string;
  };
}

interface FundState {
  mainFund: string;
  reserveFund: string;
  reserveThreshold: string;
}

describe('Funds and contributions (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let initialState: FundState;
  let president: TestUser;
  let member: TestUser;
  const contributionIds: string[] = [];

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

    const state = await database.query<FundState>(
      `SELECT
         MAX(balance) FILTER (WHERE fund_type = 'MAIN')::text AS "mainFund",
         MAX(balance) FILTER (WHERE fund_type = 'RESERVE')::text AS "reserveFund",
         (SELECT reserve_threshold::text
          FROM fund_settings WHERE setting_key = 'DEFAULT') AS "reserveThreshold"
       FROM funds`,
    );
    initialState = state.rows[0];
    const id = randomUUID();
    president = {
      id,
      role: 'PRESIDENT',
      email: `fund-president-${id}@test.invalid`,
      token: '',
    };
    const memberId = randomUUID();
    member = {
      id: memberId,
      role: 'MEMBER',
      email: `fund-member-${memberId}@test.invalid`,
      token: '',
    };
    await database.transaction(async (client) => {
      for (const user of [president, member]) {
        await client.query(
          `INSERT INTO members (id, full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'test-hash', $4)`,
          [user.id, 'Fund Test User', user.email, user.role],
        );
      }
      for (const user of [president, member]) {
        await client.query(
          `INSERT INTO membership_applications
             (id, member_id, status, decided_by, decided_at)
           VALUES ($1, $2, 'APPROVED', $3, NOW())`,
          [randomUUID(), user.id, president.id],
        );
      }
    });

    const jwt = app.get(JwtService);
    president.token = await jwt.signAsync({
      sub: president.id,
      email: president.email,
    });
    member.token = await jwt.signAsync({
      sub: member.id,
      email: member.email,
    });
  });

  afterAll(async () => {
    await database.transaction(async (client) => {
      if (contributionIds.length) {
        await client.query(
          'DELETE FROM contributions WHERE id = ANY($1::uuid[])',
          [contributionIds],
        );
      }
      await client.query(
        `UPDATE funds
         SET balance = CASE fund_type
               WHEN 'MAIN' THEN $1::numeric
               WHEN 'RESERVE' THEN $2::numeric
             END,
             updated_at = NOW()`,
        [initialState.mainFund, initialState.reserveFund],
      );
      await client.query(
        `UPDATE fund_settings
         SET reserve_threshold = $1::numeric, updated_at = NOW()
         WHERE setting_key = 'DEFAULT'`,
        [initialState.reserveThreshold],
      );
      await client.query(
        'DELETE FROM membership_applications WHERE member_id = ANY($1::uuid[])',
        [[president.id, member.id]],
      );
      await client.query('DELETE FROM members WHERE id = ANY($1::uuid[])', [
        [president.id, member.id],
      ]);
    });
    await app.close();
  });

  beforeEach(async () => {
    await setBalances('0', '0');
    await database.query(
      `UPDATE fund_settings
       SET reserve_threshold = 5000000
       WHERE setting_key = 'DEFAULT'`,
    );
    await database.query('UPDATE members SET is_active = TRUE WHERE id = $1', [
      member.id,
    ]);
  });

  it('allocates 20 percent below threshold, only the remaining gap, and none at or above threshold', async () => {
    await setBalances('0', '0');
    const below = await contribute({ amount: '100' });
    expect(below).toMatchObject({
      amount: '100',
      mainAllocated: '80.00',
      reserveAllocated: '20.00',
    });

    await setBalances('0', '4999990');
    const gap = await contribute({ amount: '100' });
    expect(gap.mainAllocated).toBe('90');
    expect(gap.reserveAllocated).toBe('10');

    await setBalances('0', '5000000');
    const exact = await contribute({ amount: '100' });
    expect(exact.mainAllocated).toBe('100');
    expect(exact.reserveAllocated).toBe('0');

    await setBalances('0', '5000001');
    const above = await contribute({ amount: '100' });
    expect(above.mainAllocated).toBe('100');
    expect(above.reserveAllocated).toBe('0');

    await setBalances('0', '0');
    const large = await contribute({ amount: '100000000000000000000' });
    expect(large.amount).toBe('100000000000000000000');
    expect(large.mainAllocated).toBe('99999999999995000000');
    expect(large.reserveAllocated).toBe('5000000');
  });

  it('rejects zero and negative amounts and requires auth for balances and reports', async () => {
    for (const amount of ['0', '0.000', '-1', 'not-a-number']) {
      await request(app.getHttpServer())
        .post('/funds/contributions')
        .send({ amount })
        .expect(400);
    }
    await request(app.getHttpServer()).get('/funds').expect(401);
    await request(app.getHttpServer()).get('/funds/reports').expect(401);
    await request(app.getHttpServer())
      .get('/funds')
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
  });

  it('accepts anonymous and authenticated contributions without trusting a client member id', async () => {
    const anonymous = await contribute({ amount: '51' });
    expect(anonymous.donorMemberId).toBeNull();

    await request(app.getHttpServer())
      .post('/funds/contributions')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ amount: '10', memberId: president.id })
      .expect(400);

    const authenticated = await contribute({ amount: '10' }, member.token);
    expect(authenticated.donorMemberId).toBe(member.id);
    expect(contributionIds).toContain(anonymous.id);
    expect(contributionIds).toContain(authenticated.id);
  });

  it('serializes concurrent contributions at the reserve threshold', async () => {
    await setBalances('0', '4999980');
    const [first, second] = await Promise.all([
      contribute({ amount: '100' }),
      contribute({ amount: '100' }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const balances = await database.query<FundState>(
      `SELECT
         MAX(balance) FILTER (WHERE fund_type = 'MAIN')::text AS "mainFund",
         MAX(balance) FILTER (WHERE fund_type = 'RESERVE')::text AS "reserveFund",
         (SELECT reserve_threshold::text
          FROM fund_settings WHERE setting_key = 'DEFAULT') AS "reserveThreshold"
       FROM funds`,
    );
    expect(balances.rows[0].mainFund).toBe('180.00');
    expect(balances.rows[0].reserveFund).toBe('5000000.00');
    expect(
      [first.body.data.reserveAllocated, second.body.data.reserveAllocated]
        .map((value: string) => Number(value))
        .sort((a: number, b: number) => a - b),
    ).toEqual([0, 20]);
  });

  it('blocks inactive accounts and retains their contribution in aggregate reports', async () => {
    const contribution = await contribute({ amount: '35' }, member.token);
    const activeReport = await request(app.getHttpServer())
      .get('/funds/reports')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      member.id,
    ]);
    await request(app.getHttpServer())
      .post('/funds/contributions')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ amount: '1' })
      .expect(403);

    const inactiveReport = await request(app.getHttpServer())
      .get('/funds/reports')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(inactiveReport.body.data.totalIncome).toBe(
      activeReport.body.data.totalIncome,
    );
    expect(inactiveReport.text).not.toContain(member.id);
    const stored = await database.query<{
      amount: string;
      isActive: boolean;
    }>(
      `SELECT c.amount::text AS amount, m.is_active AS "isActive"
       FROM contributions c
       JOIN members m ON m.id = c.donor_member_id
       WHERE c.id = $1`,
      [contribution.id],
    );
    expect(stored.rows[0]).toMatchObject({ amount: '35', isActive: false });
  });

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

  async function contribute(
    body: Record<string, unknown>,
    token?: string,
  ): Promise<
    {
      status: number;
      body: { data: ContributionData };
    } & ContributionData
  > {
    let testRequest = request(app.getHttpServer())
      .post('/funds/contributions')
      .send(body);
    if (token) {
      testRequest = testRequest.set('Authorization', `Bearer ${token}`);
    }
    const response = await testRequest;
    expect(response.status).toBe(201);
    const contribution = response.body.data as ContributionData;
    contributionIds.push(contribution.id);
    return { ...contribution, status: response.status, body: response.body };
  }
});
