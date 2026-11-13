import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { NotificationIntegrationService } from '../common/notifications/notification-integration.service';
import { EventsService } from './events.service';

describe('EventsService', () => {
  let database: jest.Mocked<DatabaseService>;
  let notifications: jest.Mocked<NotificationIntegrationService>;
  let service: EventsService;

  const president: AuthenticatedUser = {
    id: 'president-id',
    email: 'president@example.test',
    fullName: 'President',
    role: 'PRESIDENT',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  const board: AuthenticatedUser = {
    ...president,
    id: 'board-id',
    role: 'BOARD',
  };

  beforeEach(() => {
    database = {
      query: jest.fn(),
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;
    notifications = {
      eventNotificationsIntegrated: false,
      notifyPresidentNewApplication: jest.fn(),
      notifyAllMembersNewEvent: jest.fn(),
    } as unknown as jest.Mocked<NotificationIntegrationService>;
    service = new EventsService(database, notifications);
  });

  it('notifies the integration point when the President creates an event', async () => {
    const event = savedEvent();
    database.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [event], rowCount: 1 });

    await expect(service.create(validInput(), president)).resolves.toEqual(
      event,
    );
    expect(database.query.mock.calls[0][0]).toContain('VALUES ($1, $2, $3');
    expect(database.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([president.id, 'Club event']),
    );
    expect(notifications.notifyAllMembersNewEvent).toHaveBeenCalledWith(
      expect.any(String),
      'Club event',
      president.id,
    );
    expect(notifications.eventNotificationsIntegrated).toBe(false);
  });

  it('does not announce an event created by the Board', async () => {
    const event = savedEvent();
    database.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [event], rowCount: 1 });

    await service.create(validInput(), board);

    expect(notifications.notifyAllMembersNewEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid date ranges before issuing SQL', async () => {
    await expect(
      service.create(
        {
          ...validInput(),
          endDate: validInput().startDate,
        },
        president,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.query).not.toHaveBeenCalled();
    expect(notifications.notifyAllMembersNewEvent).not.toHaveBeenCalled();
  });
});

function validInput() {
  return {
    name: 'Club event',
    startDate: '2026-12-01T10:00:00.000Z',
    endDate: '2026-12-01T12:00:00.000Z',
    location: 'Club room',
    maxParticipants: 25,
  };
}

function savedEvent() {
  return {
    id: 'event-id',
    name: 'Club event',
    startDate: new Date('2026-12-01T10:00:00.000Z'),
    endDate: new Date('2026-12-01T12:00:00.000Z'),
    location: 'Club room',
    maxParticipants: 25,
    participantCount: 0,
    status: 'UPCOMING' as const,
    createdBy: 'president-id',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
  };
}
