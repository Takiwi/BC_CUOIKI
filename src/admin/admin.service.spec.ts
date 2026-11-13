import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminService, ADMIN_ENTITIES } from './admin.service';
import { DatabaseService } from '../database/database.service';

describe('AdminService', () => {
  let service: AdminService;
  let mockDatabase: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn(),
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;

    service = new AdminService(mockDatabase);
  });

  describe('getEntityConfigList', () => {
    it('should return list of all configured entities', () => {
      const list = service.getEntityConfigList();
      expect(list.length).toBe(Object.keys(ADMIN_ENTITIES).length);
      expect(list.some((item) => item.key === 'members')).toBe(true);
      expect(list.some((item) => item.key === 'funds')).toBe(true);
    });
  });

  describe('getOverviewStats', () => {
    it('should aggregate counts across entities', async () => {
      mockDatabase.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM members')) {
          return {
            rows: [
              { total: 10, active: 8, pending: 1, approved: 8, rejected: 1 },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM events')) {
          return { rows: [{ total: 5, active: 4 }], rowCount: 1 };
        }
        if (sql.includes('FROM event_registrations')) {
          return { rows: [{ total: 20, active: 18 }], rowCount: 1 };
        }
        if (sql.includes('FROM funds')) {
          return {
            rows: [
              { fund_type: 'MAIN', balance: 10000000 },
              { fund_type: 'RESERVE', balance: 5000000 },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('FROM contributions')) {
          return { rows: [{ total: 15, totalAmount: 15000000 }], rowCount: 1 };
        }
        if (sql.includes('FROM spending_proposals')) {
          return {
            rows: [
              {
                total: 3,
                pending: 1,
                approved: 1,
                rejected: 0,
                voting: 1,
                executed: 0,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM proposal_vote_rounds')) {
          return { rows: [{ total: 2 }], rowCount: 1 };
        }
        if (sql.includes('FROM proposal_votes')) {
          return { rows: [{ total: 10 }], rowCount: 1 };
        }
        if (sql.includes('FROM payables')) {
          return {
            rows: [
              {
                total: 2,
                open: 1,
                paid: 1,
                totalDue: 2000000,
                totalPaid: 1000000,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM reserve_withdrawal_requests')) {
          return {
            rows: [{ total: 1, pending: 0, approved: 1, completed: 0 }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM fund_transactions')) {
          return {
            rows: [
              { total: 4, completed: 3, pending: 1, totalVolume: 3000000 },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM notifications')) {
          return { rows: [{ total: 25, unread: 5 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const stats = await service.getOverviewStats();
      expect(stats.members.total).toBe(10);
      expect(stats.funds.main).toBe(10000000);
      expect(stats.funds.reserve).toBe(5000000);
      expect(stats.funds.total).toBe(15000000);
      expect(stats.events.total).toBe(5);
    });
  });

  describe('getEntityData', () => {
    it('should throw NotFoundException for unknown entity', async () => {
      await expect(service.getEntityData('unknown_table')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return paginated data and sanitize sensitive fields', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'm-1',
              email: 'admin@example.com',
              full_name: 'Admin',
              password_hash: 'secret_hash',
              role: 'ADMIN',
            },
          ],
          rowCount: 1,
        });

      const result = await service.getEntityData('members', {
        page: 1,
        limit: 10,
      });
      expect(result.total).toBe(1);
      expect(result.data[0].email).toBe('admin@example.com');
      expect(result.data[0].password_hash).toBe('********');
    });
  });

  describe('updateEntityRecord', () => {
    it('should throw BadRequestException if no allowed fields are updated', async () => {
      await expect(
        service.updateEntityRecord('members', 'm-1', { uneditable: 'val' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update allowed fields and return refreshed record', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({
          rows: [{ id: 'm-1', role: 'TREASURER', full_name: 'Updated Name' }],
          rowCount: 1,
        }); // SELECT

      const res = await service.updateEntityRecord('members', 'm-1', {
        role: 'TREASURER',
      });
      expect(res.data.role).toBe('TREASURER');
    });
  });

  describe('deleteEntityRecord', () => {
    it('should reject deleting from funds table', async () => {
      await expect(service.deleteEntityRecord('funds', 'f-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete record successfully', async () => {
      mockDatabase.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const res = await service.deleteEntityRecord('notifications', 'n-1');
      expect(res.success).toBe(true);
    });
  });
});
