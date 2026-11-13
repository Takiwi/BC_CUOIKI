import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDatabase: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;

    service = new NotificationsService(mockDatabase);
  });

  describe('notifyFundSufficientForDebts', () => {
    it('sends FUND_SUFFICIENT_FOR_DEBT notification to President and Treasurer', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({
          rows: [{ id: 'pres-1' }, { id: 'treas-1' }],
          rowCount: 2,
        })
        .mockResolvedValue({ rows: [], rowCount: 1 });

      await service.notifyFundSufficientForDebts('10000000', '2000000');

      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE role IN ('PRESIDENT', 'TREASURER')"),
        [],
      );
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['pres-1', 'FUND_SUFFICIENT_FOR_DEBT']),
      );
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['treas-1', 'FUND_SUFFICIENT_FOR_DEBT']),
      );
    });
  });

  describe('notifyBoardTieDecisionRequired', () => {
    it('sends TIE_BOARD_REQUIRED notification to Board members', async () => {
      mockDatabase.query
        .mockResolvedValueOnce({
          rows: [{ id: 'board-1' }],
          rowCount: 1,
        })
        .mockResolvedValue({ rows: [], rowCount: 1 });

      await service.notifyBoardTieDecisionRequired('prop-1', 'Purchase equipment');

      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE role = 'BOARD'"),
        [],
      );
      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining(['board-1', 'TIE_BOARD_REQUIRED']),
      );
    });
  });
});

