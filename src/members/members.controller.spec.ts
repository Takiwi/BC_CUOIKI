import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { AuthenticatedUser } from '../auth/auth.types';

describe('MembersController', () => {
  let controller: MembersController;
  let service: jest.Mocked<MembersService>;

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

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      findApplications: jest.fn(),
      findById: jest.fn(),
      updateProfile: jest.fn(),
      decideApplication: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<MembersService>;

    controller = new MembersController(service);
  });

  it('findAll delegates to service.findAll', async () => {
    const list = [{ id: '1', fullName: 'A' }] as any;
    service.findAll.mockResolvedValueOnce(list);

    const result = await controller.findAll();
    expect(result).toEqual({ data: list });
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('findApplications delegates to service.findApplications', async () => {
    const apps = [{ id: 'app-1', memberId: '1' }] as any;
    service.findApplications.mockResolvedValueOnce(apps);

    const result = await controller.findApplications();
    expect(result).toEqual({ data: apps });
    expect(service.findApplications).toHaveBeenCalledTimes(1);
  });

  it('findOne delegates to service.findById with current user', async () => {
    const detail = { id: memberUser.id, fullName: 'Member' } as any;
    service.findById.mockResolvedValueOnce(detail);

    const result = await controller.findOne(memberUser.id, memberUser);
    expect(result).toEqual({ data: detail });
    expect(service.findById).toHaveBeenCalledWith(memberUser.id, memberUser);
  });

  it('updateMyProfile delegates to service.updateProfile using current user id', async () => {
    const updated = { id: memberUser.id, fullName: 'Updated' } as any;
    service.updateProfile.mockResolvedValueOnce(updated);

    const result = await controller.updateMyProfile(memberUser, {
      fullName: 'Updated',
    });
    expect(result).toEqual({ data: updated });
    expect(service.updateProfile).toHaveBeenCalledWith(memberUser.id, {
      fullName: 'Updated',
    });
  });

  it('decideApplication delegates to service.decideApplication', async () => {
    const decisionResult = {
      id: 'app-1',
      memberId: 'target-1',
      status: 'APPROVED',
      reason: 'OK',
      decidedAt: new Date(),
    } as any;
    service.decideApplication.mockResolvedValueOnce(decisionResult);

    const result = await controller.decideApplication(
      'target-1',
      { decision: 'APPROVED', reason: 'OK' },
      presidentUser,
    );
    expect(result).toEqual({ data: decisionResult });
    expect(service.decideApplication).toHaveBeenCalledWith(
      'target-1',
      'APPROVED',
      'OK',
      presidentUser,
    );
  });

  it('updateStatus delegates to service.updateStatus', async () => {
    const statusResult = {
      id: 'target-1',
      isActive: false,
      statusLabel: 'Không hoạt động',
    };
    service.updateStatus.mockResolvedValueOnce(statusResult);

    const result = await controller.updateStatus(
      'target-1',
      { isActive: false },
      presidentUser,
    );
    expect(result).toEqual({ data: statusResult });
    expect(service.updateStatus).toHaveBeenCalledWith(
      'target-1',
      false,
      presidentUser,
    );
  });
});
