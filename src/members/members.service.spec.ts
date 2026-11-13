import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MembersService } from './members.service';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('MembersService', () => {
  let service: MembersService;
  let mockDatabase: jest.Mocked<DatabaseService>;

  const presidentUser: AuthenticatedUser = {
    id: 'president-uuid-1',
    email: 'president@example.com',
    fullName: 'President User',
    role: 'PRESIDENT',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  const memberUser: AuthenticatedUser = {
    id: 'member-uuid-1',
    email: 'member@example.com',
    fullName: 'Member User',
    role: 'MEMBER',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  const otherMemberUser: AuthenticatedUser = {
    id: 'member-uuid-2',
    email: 'other@example.com',
    fullName: 'Other Member',
    role: 'MEMBER',
    isActive: true,
    applicationStatus: 'APPROVED',
  };

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn(),
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;

    service = new MembersService(mockDatabase);
  });

  describe('findAll', () => {
    it('returns all members with active/inactive status labels', async () => {
      const mockRows = [
        {
          id: 'member-1',
          fullName: 'Nguyễn Văn A',
          email: 'a@example.com',
          role: 'MEMBER',
          gender: 'MALE',
          dateOfBirth: '2000-01-01',
          isActive: true,
          statusLabel: 'Hoạt động',
          applicationStatus: 'APPROVED',
          createdAt: new Date(),
        },
        {
          id: 'member-2',
          fullName: 'Trần Thị B',
          email: 'b@example.com',
          role: 'MEMBER',
          gender: 'FEMALE',
          dateOfBirth: '2001-02-02',
          isActive: false,
          statusLabel: 'Không hoạt động',
          applicationStatus: 'APPROVED',
          createdAt: new Date(),
        },
      ];
      mockDatabase.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.findAll();
      expect(result).toEqual(mockRows);
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT m.id'),
      );
    });
  });

  describe('findApplications', () => {
    it('returns applications ordered with pending first', async () => {
      const mockApps = [
        {
          id: 'app-1',
          memberId: 'member-1',
          fullName: 'Ứng viên A',
          email: 'candidate@example.com',
          gender: 'MALE',
          dateOfBirth: '2002-03-03',
          status: 'PENDING',
          decisionReason: null,
          decidedBy: null,
          decidedByName: null,
          decidedAt: null,
          createdAt: new Date(),
        },
      ];
      mockDatabase.query.mockResolvedValueOnce({
        rows: mockApps,
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.findApplications();
      expect(result).toEqual(mockApps);
    });
  });

  describe('findById', () => {
    it('allows a member to view their own profile', async () => {
      const memberDetail = {
        id: memberUser.id,
        fullName: memberUser.fullName,
        email: memberUser.email,
        role: memberUser.role,
        gender: 'MALE',
        dateOfBirth: '2000-01-01',
        isActive: true,
        statusLabel: 'Hoạt động' as const,
        applicationStatus: 'APPROVED',
        decisionReason: null,
        decidedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDatabase.query.mockResolvedValueOnce({
        rows: [memberDetail],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.findById(memberUser.id, memberUser);
      expect(result).toEqual(memberDetail);
    });

    it('forbids a regular member from viewing another member profile', async () => {
      await expect(
        service.findById(otherMemberUser.id, memberUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the President to view any member profile', async () => {
      const otherDetail = {
        id: otherMemberUser.id,
        fullName: otherMemberUser.fullName,
        email: otherMemberUser.email,
        role: otherMemberUser.role,
        gender: 'OTHER',
        dateOfBirth: '2001-01-01',
        isActive: true,
        statusLabel: 'Hoạt động' as const,
        applicationStatus: 'APPROVED',
        decisionReason: null,
        decidedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDatabase.query.mockResolvedValueOnce({
        rows: [otherDetail],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const result = await service.findById(otherMemberUser.id, presidentUser);
      expect(result).toEqual(otherDetail);
    });

    it('throws NotFoundException if member does not exist', async () => {
      mockDatabase.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(
        service.findById('non-existent-id', presidentUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates own profile with trimmed name', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({
          rows: [{ id: memberUser.id }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: memberUser.id,
              fullName: 'Updated Name',
              email: memberUser.email,
              role: memberUser.role,
              gender: 'FEMALE',
              dateOfBirth: '2000-12-12',
              isActive: true,
              statusLabel: 'Hoạt động',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          rowCount: 1,
          command: 'UPDATE',
          oid: 0,
          fields: [],
        });

      const updated = await service.updateProfile(memberUser.id, {
        fullName: '  Updated Name  ',
        gender: 'FEMALE',
        dateOfBirth: '2000-12-12',
      });

      expect(updated.fullName).toBe('Updated Name');
      expect(mockDatabase.query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE members'),
        ['Updated Name', 'FEMALE', '2000-12-12', memberUser.id],
      );
    });

    it('throws NotFoundException if user not found', async () => {
      mockDatabase.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      await expect(
        service.updateProfile('unknown-id', { fullName: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('decideApplication', () => {
    it('approves an application and returns decision', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const client = {
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rows: [{ id: 'app-uuid', status: 'PENDING' }],
              rowCount: 1,
            })
            .mockResolvedValueOnce({
              rows: [
                {
                  id: 'app-uuid',
                  memberId: memberUser.id,
                  status: 'APPROVED',
                  reason: 'Welcome to the club',
                  decidedAt: new Date(),
                },
              ],
              rowCount: 1,
            }),
        };
        return callback(client);
      });

      const result = await service.decideApplication(
        memberUser.id,
        'APPROVED',
        'Welcome to the club',
        presidentUser,
      );

      expect(result.status).toBe('APPROVED');
      expect(result.reason).toBe('Welcome to the club');
    });

    it('throws ConflictException if already decided', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const client = {
          query: jest.fn().mockResolvedValueOnce({
            rows: [{ id: 'app-uuid', status: 'APPROVED' }],
            rowCount: 1,
          }),
        };
        return callback(client);
      });

      await expect(
        service.decideApplication(
          memberUser.id,
          'APPROVED',
          undefined,
          presidentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateStatus', () => {
    it('allows President to deactivate a member and revokes refresh tokens', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const client = {
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rows: [{ id: memberUser.id, role: 'MEMBER', is_active: true }],
              rowCount: 1,
            })
            .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE members
            .mockResolvedValueOnce({ rowCount: 2 }), // UPDATE refresh_tokens
        };
        return callback(client);
      });

      const result = await service.updateStatus(
        memberUser.id,
        false,
        presidentUser,
      );
      expect(result).toEqual({
        id: memberUser.id,
        isActive: false,
        statusLabel: 'Không hoạt động',
      });
    });

    it('allows member to voluntarily deactivate their own account (leave club)', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const client = {
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rows: [{ id: memberUser.id, role: 'MEMBER', is_active: true }],
              rowCount: 1,
            })
            .mockResolvedValueOnce({ rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 }),
        };
        return callback(client);
      });

      const result = await service.updateStatus(
        memberUser.id,
        false,
        memberUser,
      );
      expect(result.isActive).toBe(false);
    });

    it('forbids normal member from deactivating someone else', async () => {
      await expect(
        service.updateStatus(otherMemberUser.id, false, memberUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('prevents deactivating the only active President', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        const client = {
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rows: [
                { id: presidentUser.id, role: 'PRESIDENT', is_active: true },
              ],
              rowCount: 1,
            })
            .mockResolvedValueOnce({
              rows: [{ count: '0' }],
              rowCount: 1,
            }),
        };
        return callback(client);
      });

      await expect(
        service.updateStatus(presidentUser.id, false, presidentUser),
      ).rejects.toThrow(ConflictException);
    });
  });
});
