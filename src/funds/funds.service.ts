import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  DatabaseService,
  PoolClient,
  QueryResultRow,
} from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateContributionDto } from './dto/create-contribution.dto';

interface FundRow extends QueryResultRow {
  fundType: 'MAIN' | 'RESERVE';
  balance: string;
}

interface ContributionRow extends QueryResultRow {
  id: string;
  amount: string;
  mainAllocated: string;
  reserveAllocated: string;
  donorMemberId: string | null;
  createdAt: Date;
}

interface FundReportRow extends QueryResultRow {
  mainFund: string;
  reserveFund: string;
  reserveThreshold: string;
  totalFund: string;
  totalIncome: string;
  totalExpense: string;
  balance: string;
}

interface EventExpenseRow extends QueryResultRow {
  eventId: string;
  eventName: string;
  totalExpense: string;
  transactionCount: number;
}

export interface FundBalances {
  mainFund: string;
  reserveFund: string;
  totalFund: string;
  reserveThreshold: string;
}

export interface FundReport extends FundBalances {
  totalIncome: string;
  totalExpense: string;
  balance: string;
  eventExpenses: EventExpenseRow[];
}

export interface ContributionResult extends ContributionRow {
  balances: FundBalances;
}

@Injectable()
export class FundsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async getBalances(): Promise<FundBalances> {
    const result = await this.database.query<FundRow>(
      `SELECT f.fund_type AS "fundType", CAST(f.balance AS NVARCHAR(50)) AS balance
       FROM funds f
       ORDER BY f.fund_type`,
    );
    return buildBalances(result.rows, this.getReserveThreshold());
  }

  async recordContribution(
    input: CreateContributionDto,
    donor: AuthenticatedUser | undefined,
  ): Promise<ContributionResult> {
    if (!isPositiveDecimal(input.amount)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    const result = await this.database.transaction(async (client) => {
      if (donor) {
        await assertActiveDonor(client, donor.id);
      }

      const reserveThreshold = this.getReserveThreshold();

      const funds = await client.query<FundRow>(
        `SELECT fund_type AS "fundType", CAST(balance AS NVARCHAR(50)) AS balance
         FROM funds WITH (UPDLOCK, ROWLOCK)
         WHERE fund_type IN ('MAIN', 'RESERVE')
         ORDER BY fund_type`,
      );
      const byType = new Map(funds.rows.map((fund) => [fund.fundType, fund]));
      const mainFund = byType.get('MAIN');
      const reserveFund = byType.get('RESERVE');
      if (!mainFund || !reserveFund) {
        throw new InternalServerErrorException(
          'Both main and reserve funds must be initialized',
        );
      }

      const { reserveAllocated, mainAllocated } =
        calculateContributionAllocation(
          input.amount,
          reserveFund.balance,
          reserveThreshold,
        );

      const contributionId = randomUUID();
      await client.executeProcedure('sp_record_contribution', {
        ContributionId: contributionId,
        DonorMemberId: donor?.id ?? null,
        Amount: input.amount,
        MainAllocated: mainAllocated,
        ReserveAllocated: reserveAllocated,
      });
      const contribution = await client.query<ContributionRow>(
        `SELECT id,
                CAST(amount AS NVARCHAR(50)) AS amount,
                CAST(main_allocated AS NVARCHAR(50)) AS "mainAllocated",
                CAST(reserve_allocated AS NVARCHAR(50)) AS "reserveAllocated",
                donor_member_id AS "donorMemberId",
                created_at AS "createdAt"
         FROM contributions
         WHERE id = $1`,
        [contributionId],
      );

      const updatedBalances = await client.query<FundRow>(
        `SELECT fund_type AS "fundType", CAST(balance AS NVARCHAR(50)) AS balance
         FROM funds
         ORDER BY fund_type`,
      );

      const debtRes = await client.query<{ totalDebt: string }>(
        `SELECT CAST(COALESCE(SUM(balance_due), 0) AS NVARCHAR(50)) AS "totalDebt"
         FROM payables
         WHERE status = 'OPEN'`,
      );
      const totalDebt = debtRes.rows[0]?.totalDebt ?? '0';
      const mainFundBalance =
        updatedBalances.rows.find((f) => f.fundType === 'MAIN')?.balance ?? '0';

      return {
        contribution: contribution.rows[0],
        balances: buildBalances(updatedBalances.rows, reserveThreshold),
        totalDebt,
        mainFundBalance,
      };
    });

    if (
      compareDecimals(result.totalDebt, '0') > 0 &&
      compareDecimals(result.mainFundBalance, result.totalDebt) >= 0
    ) {
      void this.notifications.notifyFundSufficientForDebts(
        result.mainFundBalance,
        result.totalDebt,
      );
    }

    return { ...result.contribution, balances: result.balances };
  }

  async getReport(): Promise<FundReport> {
    const reserveThreshold = this.getReserveThreshold();
    const result = await this.database.query<FundReportRow>(
      `WITH balance_totals AS (
         SELECT
           CAST(COALESCE(SUM(CASE WHEN fund_type = 'MAIN' THEN balance ELSE 0 END), 0) AS NVARCHAR(50))
             AS "mainFund",
           CAST(COALESCE(SUM(CASE WHEN fund_type = 'RESERVE' THEN balance ELSE 0 END), 0) AS NVARCHAR(50))
             AS "reserveFund",
           CAST(COALESCE(SUM(balance), 0) AS NVARCHAR(50)) AS balance
         FROM funds
       ),
       income_totals AS (
         SELECT CAST(COALESCE(SUM(amount), 0) AS NVARCHAR(50)) AS "totalIncome"
         FROM contributions
       ),
       report_totals AS (
         SELECT b."mainFund",
                b."reserveFund",
                b.balance,
                i."totalIncome",
                (SELECT CAST(COALESCE(SUM(amount), 0) AS NVARCHAR(50))
                 FROM fund_transactions
                 WHERE status = 'COMPLETED') AS "totalExpense"
         FROM balance_totals b
         CROSS JOIN income_totals i
       )
       SELECT t."mainFund" AS "mainFund",
              t."reserveFund" AS "reserveFund",
              CAST((CAST(t."mainFund" AS DECIMAL(18,2)) + CAST(t."reserveFund" AS DECIMAL(18,2))) AS NVARCHAR(50))
                AS "totalFund",
              t."totalIncome",
              t."totalExpense",
              t.balance
       FROM report_totals t`,
    );
    const report = result.rows[0];
    if (!report) {
      throw new InternalServerErrorException(
        'Fund balances are not initialized',
      );
    }
    const eventExpenses = await this.database.query<EventExpenseRow>(
      `SELECT e.id AS "eventId",
              e.name AS "eventName",
              CAST(COALESCE(SUM(t.amount), 0) AS NVARCHAR(50)) AS "totalExpense",
              COUNT(t.id) AS "transactionCount"
       FROM events e
       JOIN spending_proposals p ON p.event_id = e.id
       JOIN payables d ON d.proposal_id = p.id
       LEFT JOIN fund_transactions t
         ON t.payable_id = d.id AND t.status = 'COMPLETED'
       GROUP BY e.id, e.name
       HAVING COUNT(t.id) > 0
       ORDER BY e.name, e.id`,
    );
    return {
      mainFund: report.mainFund,
      reserveFund: report.reserveFund,
      totalFund: report.totalFund,
      reserveThreshold,
      totalIncome: report.totalIncome,
      totalExpense: report.totalExpense,
      balance: report.balance,
      eventExpenses: eventExpenses.rows,
    };
  }

  private getReserveThreshold(): string {
    const val = process.env.FUND_RESERVE_THRESHOLD?.trim();
    if (val && isPositiveDecimal(val)) {
      return val;
    }
    return '5000000';
  }
}

function buildBalances(
  rows: FundRow[],
  reserveThreshold: string,
): FundBalances {
  const byType = new Map(rows.map((fund) => [fund.fundType, fund.balance]));
  const mainFund = byType.get('MAIN');
  const reserveFund = byType.get('RESERVE');
  if (mainFund === undefined || reserveFund === undefined) {
    throw new InternalServerErrorException(
      'Both main and reserve funds must be initialized',
    );
  }
  return {
    mainFund,
    reserveFund,
    totalFund: addDecimals(mainFund, reserveFund),
    reserveThreshold,
  };
}

async function updateFundBalance(
  client: PoolClient,
  fundType: 'MAIN' | 'RESERVE',
  amount: string,
): Promise<void> {
  await client.query(
    `UPDATE funds
     SET balance = balance + CAST($1 AS DECIMAL(18,2)), updated_at = SYSUTCDATETIME()
     WHERE fund_type = $2`,
    [amount, fundType],
  );
}

async function assertActiveDonor(
  client: PoolClient,
  memberId: string,
): Promise<void> {
  const result = await client.query<{ isActive: boolean; status: string }>(
    `SELECT m.is_active AS "isActive", m.status
     FROM members m WITH (HOLDLOCK, ROWLOCK)
     WHERE m.id = $1`,
    [memberId],
  );
  if (!result.rows[0]?.isActive || result.rows[0].status !== 'APPROVED') {
    throw new ForbiddenException('Account is inactive or not approved');
  }
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

function addDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const factor = 10n ** BigInt(scale);
  const leftMinor =
    BigInt(leftWhole) * factor + BigInt(leftFraction.padEnd(scale, '0') || '0');
  const rightMinor =
    BigInt(rightWhole) * factor +
    BigInt(rightFraction.padEnd(scale, '0') || '0');
  const sum = leftMinor + rightMinor;
  const whole = sum / factor;
  const fraction = (sum % factor)
    .toString()
    .padStart(scale, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseToCents(val: string): bigint {
  const [whole = '0', frac = ''] = val.trim().split('.');
  const twoDecimals = frac.padEnd(2, '0').slice(0, 2);
  return BigInt(whole || '0') * 100n + BigInt(twoDecimals);
}

function formatCents(cents: bigint): string {
  const whole = cents / 100n;
  const rem = cents % 100n;
  if (rem === 0n) {
    return whole.toString();
  }
  return `${whole}.${rem.toString().padStart(2, '0')}`;
}

function compareDecimals(left: string, right: string): number {
  const leftCents = parseToCents(left);
  const rightCents = parseToCents(right);
  return leftCents < rightCents ? -1 : leftCents > rightCents ? 1 : 0;
}

export function calculateContributionAllocation(
  amountStr: string,
  reserveBalanceStr: string,
  reserveThresholdStr: string,
): { reserveAllocated: string; mainAllocated: string } {
  const amountCents = parseToCents(amountStr);
  const reserveCents = parseToCents(reserveBalanceStr);
  const thresholdCents = parseToCents(reserveThresholdStr);

  // 20% of contribution goes to reserve fund, but only up to reserve threshold
  const maxTwentyPercent = (amountCents * 20n) / 100n;
  const neededForReserve =
    thresholdCents > reserveCents ? thresholdCents - reserveCents : 0n;

  let reserveAllocatedCents = 0n;
  if (neededForReserve > 0n) {
    reserveAllocatedCents =
      maxTwentyPercent < neededForReserve ? maxTwentyPercent : neededForReserve;
  }
  const mainAllocatedCents = amountCents - reserveAllocatedCents;

  return {
    reserveAllocated: formatCents(reserveAllocatedCents),
    mainAllocated: formatCents(mainAllocatedCents),
  };
}
