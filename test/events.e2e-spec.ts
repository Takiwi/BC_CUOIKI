import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { DatabaseService } from '../src/database/database.service';
import { AppModule } from '../src/app.module';

interface TestUser {
  id: string;
  role: AuthenticatedUser['role'];
  email: string;
  fullName: string;
  token: string;
}

interface EventResponse {
  id: string;
  status: 'UPCOMING' | 'ONGOING' | 'ENDED';
  participantCount: number;
}

describe('Events (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const users = new Map<string, TestUser>();

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

    for (const role of [
      'PRESIDENT',
      'BOARD',
      'TREASURER',
      'MEMBER',
      'MEMBER',
      'PRESIDENT',
    ] as const) {
      const id = randomUUID();
      const user: TestUser = {
        id,
        role,
        email: `${role.toLowerCase()}-${id}@events-test.invalid`,
        fullName: `Event Test ${role}`,
        token: '',
      };
      users.set(`${role}-${users.size}`, user);
    }

    const fixtures = [...users.values()];
    await database.transaction(async (client) => {
      for (const user of fixtures) {
        await client.query(
          `INSERT INTO members (id, full_name, email, password_hash, role)
           VALUES ($1, $2, $3, 'test-hash', $4)`,
          [user.id, user.fullName, user.email, user.role],
        );
      }
      const president = fixtures.find((user) => user.role === 'PRESIDENT');
      if (!president) {
        throw new Error('President test fixture was not created');
      }
      for (const user of fixtures) {
        await client.query(
          `INSERT INTO membership_applications
             (id, member_id, status, decided_by, decided_at)
           VALUES ($1, $2, 'APPROVED', $3, NOW())`,
          [randomUUID(), user.id, president.id],
        );
      }
    });

    const jwt = app.get(JwtService);
    for (const user of fixtures) {
      user.token = await jwt.signAsync({ sub: user.id, email: user.email });
    }
  });

  afterAll(async () => {
    const ids = [...users.values()].map((user) => user.id);
    if (ids.length) {
      await database.query(
        'DELETE FROM events WHERE created_by = ANY($1::uuid[])',
        [ids],
      );
      await database.query(
        'DELETE FROM refresh_tokens WHERE member_id = ANY($1::uuid[])',
        [ids],
      );
      await database.query(
        'DELETE FROM membership_applications WHERE member_id = ANY($1::uuid[])',
        [ids],
      );
      await database.query('DELETE FROM members WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
    }
    await app.close();
  });

  it('validates date ranges, reports event status and prevents deleting started events', async () => {
    const president = userWithRole('PRESIDENT');
    await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${president.token}`)
      .send(eventInput('2026-12-01T10:00:00.000Z', '2026-12-01T10:00:00.000Z'))
      .expect(400);

    const upcoming = await createEvent(president, futureRange());
    expect(upcoming.status).toBe('UPCOMING');
    expect(upcoming.participantCount).toBe(0);
    const eventList = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(readEventIds(eventList.body)).toContain(upcoming.id);

    const ongoingRange = pastStartFutureEnd();
    const ongoing = await createEvent(president, ongoingRange);
    expect(ongoing.status).toBe('ONGOING');

    const ended = await createEvent(president, pastRange());
    expect(ended.status).toBe('ENDED');
    await request(app.getHttpServer())
      .delete(`/events/${ended.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/events/${upcoming.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
  });

  it('allows President and Board to manage events, but denies Treasurer', async () => {
    const board = userWithRole('BOARD');
    const treasurer = userWithRole('TREASURER');
    const created = await createEvent(board, futureRange());

    await request(app.getHttpServer())
      .patch(`/events/${created.id}`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({ name: 'Board-updated event' })
      .expect(200)
      .expect(({ body }) => expect(body.data.name).toBe('Board-updated event'));

    await request(app.getHttpServer())
      .patch(`/events/${created.id}`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .send({ name: 'Unauthorized update' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/events/${created.id}`)
      .set('Authorization', `Bearer ${treasurer.token}`)
      .expect(403);

    const invalidUpdate = await request(app.getHttpServer())
      .patch(`/events/${created.id}`)
      .set('Authorization', `Bearer ${board.token}`)
      .send({
        startDate: '2026-12-01T12:00:00.000Z',
        endDate: '2026-12-01T11:00:00.000Z',
      })
      .expect(400);
    expect(invalidUpdate.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
  });

  it('serializes concurrent registrations, blocks duplicates, and allows cancellation', async () => {
    const president = userWithRole('PRESIDENT');
    const firstMember = userWithRole('MEMBER', 0);
    const secondMember = userWithRole('MEMBER', 1);
    const event = await createEvent(president, futureRange(1));

    const requests = [firstMember, secondMember].map((member) =>
      request(app.getHttpServer())
        .post(`/events/${event.id}/registrations`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect((response) => {
          expect([201, 409]).toContain(response.status);
        }),
    );
    const results = await Promise.all(requests);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const registeredUser =
      results[0].status === 201 ? firstMember : secondMember;
    const notRegisteredUser =
      results[0].status === 409 ? firstMember : secondMember;

    const duplicate = await request(app.getHttpServer())
      .post(`/events/${event.id}/registrations`)
      .set('Authorization', `Bearer ${registeredUser.token}`)
      .expect(409);
    expect(readMessage(duplicate.body)).toContain('already registered');

    await request(app.getHttpServer())
      .get(`/events/${event.id}/registrations/me`)
      .set('Authorization', `Bearer ${registeredUser.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('ACTIVE'));

    await request(app.getHttpServer())
      .delete(`/events/${event.id}/registrations/me`)
      .set('Authorization', `Bearer ${registeredUser.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/events/${event.id}/registrations`)
      .set('Authorization', `Bearer ${notRegisteredUser.token}`)
      .expect(201);

    const eventDetail = await request(app.getHttpServer())
      .get(`/events/${event.id}`)
      .set('Authorization', `Bearer ${president.token}`)
      .expect(200);
    expect(readEvent(eventDetail.body).participantCount).toBe(1);

    const identityCheckEvent = await createEvent(president, futureRange());
    const tokenIdentityCheck = await request(app.getHttpServer())
      .post(`/events/${identityCheckEvent.id}/registrations`)
      .set('Authorization', `Bearer ${registeredUser.token}`)
      .send({ memberId: notRegisteredUser.id })
      .expect(201);
    expect(tokenIdentityCheck.body.data.memberId).toBe(registeredUser.id);
  });

  it('rejects inactive members and non-member registration roles', async () => {
    const inactivePresident = userWithRole('PRESIDENT', 1);
    const event = await createEvent(userWithRole('PRESIDENT'), futureRange());
    await database.query('UPDATE members SET is_active = FALSE WHERE id = $1', [
      inactivePresident.id,
    ]);

    await request(app.getHttpServer())
      .post(`/events/${event.id}/registrations`)
      .set('Authorization', `Bearer ${inactivePresident.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/events/${event.id}/registrations`)
      .set('Authorization', `Bearer ${userWithRole('TREASURER').token}`)
      .expect(403);
  });

  async function createEvent(
    actor: TestUser,
    range: { startDate: string; endDate: string; maxParticipants?: number },
  ): Promise<EventResponse> {
    const response = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${actor.token}`)
      .send(eventInput(range.startDate, range.endDate, range.maxParticipants))
      .expect(201);
    const event = readEvent(response.body);
    return event;
  }

  function userWithRole(role: TestUser['role'], occurrence = 0): TestUser {
    const found = [...users.values()].filter((user) => user.role === role)[
      occurrence
    ];
    if (!found) {
      throw new Error(`Missing ${role} test fixture`);
    }
    return found;
  }
});

function eventInput(
  startDate: string,
  endDate: string,
  maxParticipants?: number,
) {
  return {
    name: 'Event management test',
    startDate,
    endDate,
    location: 'Test location',
    ...(maxParticipants === undefined ? {} : { maxParticipants }),
  };
}

function futureRange(maxParticipants?: number) {
  return {
    startDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    maxParticipants,
  };
}

function pastRange() {
  return {
    startDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}

function pastStartFutureEnd() {
  return {
    startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function readEvent(body: unknown): EventResponse {
  if (!isRecord(body) || !isRecord(body.data)) {
    throw new Error('Event response has an invalid shape');
  }
  const { id, status, participantCount } = body.data;
  if (
    typeof id !== 'string' ||
    typeof status !== 'string' ||
    typeof participantCount !== 'number'
  ) {
    throw new Error('Event response has invalid fields');
  }
  return {
    id,
    status: status as EventResponse['status'],
    participantCount,
  };
}

function readMessage(body: unknown): string {
  if (!isRecord(body) || typeof body.message !== 'string') {
    throw new Error('Error response has an invalid shape');
  }
  return body.message;
}

function readEventIds(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error('Event list response has an invalid shape');
  }
  return body.data.flatMap((event: unknown) => {
    if (!isRecord(event) || typeof event.id !== 'string') {
      throw new Error('Event list contains an invalid event');
    }
    return [event.id];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
