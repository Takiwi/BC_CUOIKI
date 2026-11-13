import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('ProposalsService', () => {
  let service: ProposalsService;
  let mockDatabase: jest.Mocked<DatabaseService>;
  let mockNotifications: jest.Mocked<NotificationsService>;

  const memberUser: AuthenticatedUser = {
    id: 'member-1',
    email: 'member@example.com',
    fullName: 'Member User',
    role: 'MEMBER',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  const treasurerUser: AuthenticatedUser = {
    id: 'treasurer-1',
    email: 'treasurer@example.com',
    fullName: 'Treasurer User',
    role: 'TREASURER',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn(),
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;

    mockNotifications = {
      notifyProposalCreated: jest.fn(),
      notifyProposalDecided: jest.fn(),
      notifyBoardTieDecisionRequired: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    service = new ProposalsService(mockDatabase, mockNotifications);
  });

  describe('vote', () => {
    it('prevents member from voting on their own proposal', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((queryText: string) => {
            if (queryText.includes('FROM spending_proposals')) {
              return Promise.resolve({
                rows: [
                  {
                    id: 'prop-1',
                    creatorMemberId: 'member-1',
                    eventId: null,
                    amount: '500000',
                    purpose: 'Test proposal',
                    status: 'VOTING',
                  },
                ],
                rowCount: 1,
              });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          }),
        };
        return callback(mockClient as any);
      });

      await expect(
        service.vote('prop-1', { choice: 'YES' }, memberUser),
      ).rejects.toThrow(ConflictException);
    });

    it('validates voter registration deadline for event proposal', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((queryText: string) => {
            if (queryText.includes('FROM spending_proposals')) {
              return Promise.resolve({
                rows: [
                  {
                    id: 'prop-1',
                    creatorMemberId: 'other-user',
                    eventId: 'event-1',
                    amount: '500000',
                    purpose: 'Event expense',
                    status: 'VOTING',
                  },
                ],
                rowCount: 1,
              });
            }
            if (queryText.includes('FROM proposal_vote_rounds')) {
              return Promise.resolve({
                rows: [
                  {
                    id: 'round-1',
                    roundNumber: 1,
                    deadlineAt: new Date(Date.now() + 86400000),
                    closedAt: null,
                  },
                ],
                rowCount: 1,
              });
            }
            if (queryText.includes('FROM event_registrations')) {
              // Not eligible (registered after deadline or inactive)
              return Promise.resolve({ rows: [], rowCount: 0 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          }),
        };
        return callback(mockClient as any);
      });

      await expect(
        service.vote('prop-1', { choice: 'YES' }, memberUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('approve', () => {
    it('rejects approval if open commitments plus proposal amount exceed total fund balance (BR-010)', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((queryText: string) => {
            if (queryText.includes('FROM spending_proposals')) {
              return Promise.resolve({
                rows: [
                  {
                    id: 'prop-1',
                    creatorMemberId: 'member-1',
                    amount: '4000000',
                    purpose: 'Buy items',
                    status: 'PENDING_APPROVAL',
                  },
                ],
                rowCount: 1,
              });
            }
            if (queryText.includes('SELECT role FROM members')) {
              return Promise.resolve({
                rows: [{ role: 'MEMBER' }],
                rowCount: 1,
              });
            }
            if (queryText.includes('WHERE fund_type IN')) {
              return Promise.resolve({
                rows: [
                  { fundType: 'MAIN', balance: '3000000' },
                  { fundType: 'RESERVE', balance: '2000000' },
                ],
                rowCount: 2,
              });
            }
            if (queryText.includes('SELECT SUM(balance) FROM funds')) {
              // Total funds: 5M. Existing open commitments: 2M.
              // New proposal: 4M. 2M + 4M = 6M > 5M -> ConflictException!
              return Promise.resolve({
                rows: [
                  {
                    totalBalance: '5000000',
                    approvedCommitments: '2000000',
                  },
                ],
                rowCount: 1,
              });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
          }),
        };
        return callback(mockClient as any);
      });

      await expect(
        service.approve('prop-1', { decision: 'APPROVED' }, treasurerUser),
      ).rejects.toThrow(ConflictException);
    });
  });
});

