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
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

export type EventStatus = 'UPCOMING' | 'ONGOING' | 'ENDED';

export interface EventRecord extends QueryResultRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string;
  maxParticipants: number | null;
  participantCount: number;
  status: EventStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LockedEvent extends QueryResultRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string;
  maxParticipants: number | null;
  participantCount: number;
}

interface EventColumns extends QueryResultRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string;
  maxParticipants: number | null;
}

export interface RegistrationRecord extends QueryResultRow {
  eventId: string;
  memberId: string;
  status: 'ACTIVE' | 'CANCELLED';
  registeredAt: Date;
  cancelledAt: Date | null;
}

const eventSelect = `
  SELECT e.id,
         e.name,
         e.startDate,
         e.endDate,
         e.location,
         e.maxParticipants,
         e.createdBy,
         e.createdAt,
         e.updatedAt,
         e.participantCount,
         e.status
  FROM v_event_details e
`;

@Injectable()
export class EventsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(): Promise<EventRecord[]> {
    const result = await this.database.query<EventRecord>(
      `${eventSelect}
       ORDER BY e.startDate, e.id`,
    );
    return result.rows;
  }

  async findById(eventId: string): Promise<EventRecord> {
    const result = await this.database.query<EventRecord>(
      `${eventSelect}
       WHERE e.id = $1`,
      [eventId],
    );
    const event = result.rows[0];
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async create(
    input: CreateEventDto,
    actor: AuthenticatedUser,
  ): Promise<EventRecord> {
    validateDateRange(input.startDate, input.endDate);
    const id = randomUUID();

    await this.database.query(
      `INSERT INTO events
         (id, created_by, name, start_at, end_at, location, max_participants)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        actor.id,
        input.name.trim(),
        input.startDate,
        input.endDate,
        input.location.trim(),
        input.maxParticipants ?? null,
      ],
    );

    if (actor.role === 'PRESIDENT') {
      void this.notifications.notifyAllMembersNewEvent(
        id,
        input.name.trim(),
        actor.id,
      );
    }
    return this.findById(id);
  }

  async update(eventId: string, input: UpdateEventDto): Promise<EventRecord> {
    await this.database.transaction(async (client) => {
      const event = await lockEvent(client, eventId);
      const startDate =
        input.startDate === undefined
          ? event.startDate.toISOString()
          : input.startDate;
      const endDate =
        input.endDate === undefined
          ? event.endDate.toISOString()
          : input.endDate;
      validateDateRange(startDate, endDate);

      const name =
        typeof input.name === 'string' ? input.name.trim() : event.name;
      const location =
        typeof input.location === 'string'
          ? input.location.trim()
          : event.location;
      if (
        input.name !== undefined &&
        (typeof input.name !== 'string' || !name)
      ) {
        throw new BadRequestException('Event name cannot be blank');
      }
      if (
        input.location !== undefined &&
        (typeof input.location !== 'string' || !location)
      ) {
        throw new BadRequestException('Event location cannot be blank');
      }
      const maxParticipants =
        input.maxParticipants === undefined
          ? event.maxParticipants
          : input.maxParticipants;
      if (
        input.maxParticipants !== undefined &&
        input.maxParticipants !== null &&
        (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 1)
      ) {
        throw new BadRequestException(
          'maxParticipants must be a positive integer or null',
        );
      }
      if (
        maxParticipants !== null &&
        maxParticipants < event.participantCount
      ) {
        throw new ConflictException(
          'Maximum participants cannot be less than current registrations',
        );
      }

      await client.query(
        `UPDATE events
         SET name = $1,
             start_at = $2,
             end_at = $3,
             location = $4,
             max_participants = $5,
             updated_at = SYSUTCDATETIME()
         WHERE id = $6`,
        [name, startDate, endDate, location, maxParticipants, eventId],
      );
    });
    return this.findById(eventId);
  }

  async remove(eventId: string): Promise<{ id: string; deleted: true }> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `DELETE FROM events
         OUTPUT deleted.id
         WHERE id = $1 AND start_at > SYSUTCDATETIME()`,
        [eventId],
      );
      if (result.rows[0]) {
        return { id: result.rows[0].id, deleted: true };
      }

      const existing = await client.query(
        'SELECT 1 FROM events WHERE id = $1',
        [eventId],
      );
      if (!existing.rowCount) {
        throw new NotFoundException('Event not found');
      }
      throw new ConflictException('An event cannot be deleted after it starts');
    });
  }

  async register(eventId: string, member: AuthenticatedUser) {
    return this.database.transaction(async (client) => {
      await lockActiveMember(client, member.id);
      const event = await lockEvent(client, eventId);
      const existingRegistration = await client.query(
        `SELECT 1
         FROM event_registrations
         WHERE event_id = $1 AND member_id = $2 AND status = 'ACTIVE'`,
        [eventId, member.id],
      );
      if (existingRegistration.rowCount) {
        throw new ConflictException(
          'Member is already registered for this event',
        );
      }
      if (
        event.maxParticipants !== null &&
        event.participantCount >= event.maxParticipants
      ) {
        throw new ConflictException('Event has reached its participant limit');
      }

      const registration = await client.query<RegistrationRecord>(
        `MERGE event_registrations AS target
         USING (SELECT $1 AS event_id, $2 AS member_id) AS source
         ON (target.event_id = source.event_id AND target.member_id = source.member_id)
         WHEN MATCHED AND target.status = 'CANCELLED' THEN
           UPDATE SET status = 'ACTIVE',
                      registered_at = SYSUTCDATETIME(),
                      cancelled_at = NULL
         WHEN NOT MATCHED THEN
           INSERT (event_id, member_id, status, registered_at)
           VALUES (source.event_id, source.member_id, 'ACTIVE', SYSUTCDATETIME())
         OUTPUT inserted.event_id AS "eventId",
                inserted.member_id AS "memberId",
                inserted.status,
                inserted.registered_at AS "registeredAt",
                inserted.cancelled_at AS "cancelledAt";`,
        [eventId, member.id],
      );
      if (!registration.rowCount) {
        throw new ConflictException(
          'Member is already registered for this event',
        );
      }
      return registration.rows[0];
    });
  }

  async cancelRegistration(eventId: string, member: AuthenticatedUser) {
    return this.database.transaction(async (client) => {
      await lockActiveMember(client, member.id);
      await lockEvent(client, eventId);
      const result = await client.query<RegistrationRecord>(
        `UPDATE event_registrations
         SET status = 'CANCELLED', cancelled_at = SYSUTCDATETIME()
         OUTPUT inserted.event_id AS "eventId",
                inserted.member_id AS "memberId",
                inserted.status,
                inserted.registered_at AS "registeredAt",
                inserted.cancelled_at AS "cancelledAt"
         WHERE event_id = $1 AND member_id = $2 AND status = 'ACTIVE'`,
        [eventId, member.id],
      );
      if (!result.rowCount) {
        throw new NotFoundException('Active event registration not found');
      }

      // Xóa phiếu đã bỏ (nếu có) ở các vòng biểu quyết đề xuất chi cho sự kiện này mà vẫn đang mở
      await client.query(
        `DELETE v
         FROM proposal_votes v
         JOIN proposal_vote_rounds r ON r.id = v.round_id
         JOIN spending_proposals p ON p.id = r.proposal_id
         WHERE p.event_id = $1
           AND v.member_id = $2
           AND r.closed_at IS NULL
           AND p.status = 'VOTING'`,
        [eventId, member.id],
      );

      return result.rows[0];
    });
  }

  async getMyRegistration(eventId: string, member: AuthenticatedUser) {
    const result = await this.database.query<RegistrationRecord>(
      `SELECT event_id AS "eventId",
              member_id AS "memberId",
              status,
              registered_at AS "registeredAt",
              cancelled_at AS "cancelledAt"
       FROM event_registrations
       WHERE event_id = $1 AND member_id = $2 AND status = 'ACTIVE'`,
      [eventId, member.id],
    );
    if (!result.rowCount) {
      const event = await this.database.query(
        'SELECT 1 FROM events WHERE id = $1',
        [eventId],
      );
      if (!event.rowCount) {
        throw new NotFoundException('Event not found');
      }
      return { eventId, memberId: member.id, status: null };
    }
    return result.rows[0];
  }
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new BadRequestException('Event startDate must be before endDate');
  }
}

async function lockEvent(
  client: PoolClient,
  eventId: string,
): Promise<LockedEvent> {
  const result = await client.query<EventColumns>(
    `SELECT id,
            name,
            start_at AS "startDate",
            end_at AS "endDate",
            location,
            max_participants AS "maxParticipants"
     FROM events WITH (UPDLOCK, ROWLOCK)
     WHERE id = $1`,
    [eventId],
  );
  const event = result.rows[0];
  if (!event) {
    throw new NotFoundException('Event not found');
  }
  const count = await client.query<{ participantCount: number }>(
    `SELECT COUNT(*) AS "participantCount"
     FROM event_registrations
     WHERE event_id = $1 AND status = 'ACTIVE'`,
    [eventId],
  );
  return { ...event, participantCount: Number(count.rows[0].participantCount) };
}

async function lockActiveMember(
  client: PoolClient,
  memberId: string,
): Promise<void> {
  const result = await client.query<{ isActive: boolean }>(
    'SELECT is_active AS "isActive" FROM members WITH (UPDLOCK, ROWLOCK) WHERE id = $1',
    [memberId],
  );
  if (!result.rows[0]?.isActive) {
    throw new ForbiddenException('Account is inactive');
  }
}
