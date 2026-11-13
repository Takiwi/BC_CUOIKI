import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const email = `prompt-one-${Date.now()}@example.com`;
  const password = 'Valid-Prompt-Password-123';
  let memberId: string;
  let accessToken: string;
  let refreshToken: string;

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
  });

  afterAll(async () => {
    if (memberId) {
      await database.query('DELETE FROM refresh_tokens WHERE member_id = $1', [
        memberId,
      ]);
      await database.query(
        'DELETE FROM membership_applications WHERE member_id = $1',
        [memberId],
      );
      await database.query('DELETE FROM members WHERE id = $1', [memberId]);
    }
    await app.close();
  });

  it('validates registration and keeps applications separate from account activity', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Test Member',
        email,
        password: 'short',
      })
      .expect(400);
    expect(invalid.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
    expect(invalid.body).not.toHaveProperty('stack');

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Test Member',
        email,
        password,
        dateOfBirth: '2000-02-31',
      })
      .expect(400);

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Test Member',
        email,
        password,
        gender: 'OTHER',
        dateOfBirth: '2000-01-01',
      })
      .expect(201);
    const registrationData = parseRegistrationResponse(registered.body);
    memberId = registrationData.id;
    expect(registrationData.applicationStatus).toBe('PENDING');

    const account = await database.query<{
      is_active: boolean;
      password_hash: string;
    }>('SELECT is_active, password_hash FROM members WHERE id = $1', [
      memberId,
    ]);
    expect(account.rows[0].is_active).toBe(true);
    expect(account.rows[0].password_hash).not.toBe(password);

    const duplicate = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ fullName: 'Duplicate', email, password })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
    });
  });

  it('rejects invalid credentials and pending applications', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Wrong-Password-123' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(403);

    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('authenticates approved accounts, refreshes sessions, and enforces roles and inactivity', async () => {
    await database.query(
      `UPDATE membership_applications
       SET status = 'APPROVED', decided_by = $2, decided_at = NOW()
       WHERE member_id = $1`,
      [memberId, memberId],
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const loginData = parseSessionResponse(login.body);
    accessToken = loginData.accessToken;
    refreshToken = loginData.refreshToken;

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const guestAccess = await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);
    expect(guestAccess.body).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
    });

    await request(app.getHttpServer())
      .patch(`/members/${memberId}/approval`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ decision: 'REJECTED' })
      .expect(403);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const rotatedRefreshToken = parseSessionResponse(
      refreshed.body,
    ).refreshToken;
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    const logoutLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const logoutRefreshToken = parseSessionResponse(
      logoutLogin.body,
    ).refreshToken;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: logoutRefreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: logoutRefreshToken })
      .expect(401);

    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      memberId,
    ]);
    const inactiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(403);
    expect(readErrorMessage(inactiveLogin.body)).toBe('Account is inactive');

    const inactiveAccess = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(inactiveAccess.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
    });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(403);
  });

  it('allows applicants with rejected applications to re-apply with the same email', async () => {
    const rejectedEmail = `rejected-applicant-${Date.now()}@example.com`;
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Rejected Candidate',
        email: rejectedEmail,
        password: 'InitialPassword123',
      })
      .expect(201);
    const rejectedMemberId = parseRegistrationResponse(regRes.body).id;

    // Simulate President rejecting the application
    await database.query(
      `UPDATE membership_applications
       SET status = 'REJECTED', decided_by = $1, decided_at = NOW(), decision_reason = 'Not eligible this semester'
       WHERE member_id = $1`,
      [rejectedMemberId],
    );

    // Login is blocked when rejected
    const rejectedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: rejectedEmail, password: 'InitialPassword123' })
      .expect(403);
    expect(readErrorMessage(rejectedLogin.body)).toContain('rejected');

    // Candidate re-applies with updated info and new password
    const reApplyRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        fullName: 'Reapplied Candidate',
        email: rejectedEmail,
        password: 'NewUpdatedPassword456',
      })
      .expect(201);
    const reApplyData = parseRegistrationResponse(reApplyRes.body);
    expect(reApplyData.id).toBe(rejectedMemberId);
    expect(reApplyData.applicationStatus).toBe('PENDING');

    // New status is PENDING, so login is blocked as pending
    const pendingLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: rejectedEmail, password: 'NewUpdatedPassword456' })
      .expect(403);
    expect(readErrorMessage(pendingLogin.body)).toContain('pending');

    // Clean up
    await database.query(
      'DELETE FROM membership_applications WHERE member_id = $1',
      [rejectedMemberId],
    );
    await database.query('DELETE FROM members WHERE id = $1', [
      rejectedMemberId,
    ]);
  });
});

function parseRegistrationResponse(body: unknown): {
  id: string;
  applicationStatus: string;
} {
  if (!isRecord(body) || !isRecord(body.data)) {
    throw new Error('Registration response has an invalid shape');
  }
  const { id, applicationStatus } = body.data;
  if (typeof id !== 'string' || typeof applicationStatus !== 'string') {
    throw new Error('Registration response has invalid fields');
  }
  return { id, applicationStatus };
}

function parseSessionResponse(body: unknown): {
  accessToken: string;
  refreshToken: string;
} {
  if (!isRecord(body) || !isRecord(body.data)) {
    throw new Error('Session response has an invalid shape');
  }
  const { accessToken: access, refreshToken: refresh } = body.data;
  if (typeof access !== 'string' || typeof refresh !== 'string') {
    throw new Error('Session response has invalid tokens');
  }
  return { accessToken: access, refreshToken: refresh };
}

function readErrorMessage(body: unknown): string {
  if (!isRecord(body) || typeof body.message !== 'string') {
    throw new Error('Error response has an invalid shape');
  }
  return body.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
