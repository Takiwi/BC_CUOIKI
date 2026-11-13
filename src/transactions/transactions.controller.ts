import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateReserveWithdrawalDto } from './dto/create-reserve-withdrawal.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { TransactionDecisionDto } from './dto/transaction-decision.dto';
import { TransactionsService } from './transactions.service';

const STAFF_ROLES = ['PRESIDENT', 'TREASURER', 'BOARD'] as const;
const EXECUTOR_ROLES = ['TREASURER', 'BOARD'] as const;

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('funds')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('transactions')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Liệt kê giao dịch tài chính và trạng thái' })
  async getTransactions() {
    return { data: await this.transactionsService.getTransactions() };
  }

  @Post('proposals/:proposalId/transactions')
  @Roles(...EXECUTOR_ROLES)
  @ApiOperation({
    summary: 'Tạo giao dịch PENDING cho đề xuất đã được duyệt',
  })
  async createProposalPayment(
    @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
    @Body() input: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.createProposalPayment(
        proposalId,
        input,
        actor,
        idempotencyKey ?? '',
      ),
    };
  }

  @Post('debts/:id/payments')
  @Roles(...EXECUTOR_ROLES)
  @ApiOperation({ summary: 'Tạo giao dịch PENDING để trả một phần khoản nợ' })
  async createDebtPayment(
    @Param('id', new ParseUUIDPipe()) payableId: string,
    @Body() input: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.createDebtPayment(
        payableId,
        input,
        actor,
        idempotencyKey ?? '',
      ),
    };
  }

  @Patch('transactions/:id/overage-decision')
  @Roles('BOARD')
  @ApiOperation({
    summary: 'Ban chủ nhiệm quyết định phần vượt đề xuất được duyệt',
  })
  async decideOverage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransactionDecisionDto,
    @CurrentUser() reviewer: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.decideOverage(id, input, reviewer),
    };
  }

  @Post('transactions/:id/complete')
  @Roles(...EXECUTOR_ROLES)
  @ApiOperation({
    summary: 'Hoàn tất giao dịch và cập nhật quỹ cùng khoản phải trả',
  })
  async completeTransaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.completeTransaction(id, actor),
    };
  }

  @Patch('transactions/:id/reject')
  @Roles(...EXECUTOR_ROLES)
  @ApiOperation({ summary: 'Từ chối giao dịch PENDING kèm lý do' })
  async rejectTransaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RejectTransactionDto,
  ) {
    return {
      data: await this.transactionsService.rejectTransaction(id, input),
    };
  }

  @Get('debts')
  @Roles('MEMBER', ...STAFF_ROLES)
  @ApiOperation({ summary: 'Xem khoản phải trả theo quyền của vai trò' })
  async getDebts(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.transactionsService.getDebts(actor) };
  }

  @Get('debts/:id')
  @Roles('MEMBER', ...STAFF_ROLES)
  @ApiOperation({ summary: 'Xem chi tiết và lịch sử thanh toán khoản nợ' })
  async getDebt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.transactionsService.getDebt(id, actor) };
  }

  @Get('reserve-withdrawals')
  @Roles('TREASURER', 'BOARD')
  @ApiOperation({ summary: 'Liệt kê yêu cầu sử dụng quỹ dự phòng' })
  async getReserveWithdrawals() {
    return {
      data: await this.transactionsService.getReserveWithdrawals(),
    };
  }

  @Post('withdraw-reserve')
  @Roles('TREASURER')
  @ApiOperation({
    summary: 'Tạo yêu cầu sử dụng quỹ dự phòng để Board phê duyệt',
  })
  async createReserveWithdrawal(
    @Body() input: CreateReserveWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.createReserveWithdrawal(
        input,
        actor,
        idempotencyKey ?? '',
      ),
    };
  }

  @Patch('reserve-withdrawals/:id/decision')
  @Roles('BOARD')
  @ApiOperation({
    summary: 'Board phê duyệt hoặc từ chối sử dụng quỹ dự phòng',
  })
  async decideReserveWithdrawal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: TransactionDecisionDto,
    @CurrentUser() reviewer: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.decideReserveWithdrawal(
        id,
        input,
        reviewer,
      ),
    };
  }

  @Post('reserve-withdrawals/:id/complete')
  @Roles(...EXECUTOR_ROLES)
  @ApiOperation({
    summary: 'Treasurer hoặc Board thực hiện yêu cầu đã được Board duyệt',
  })
  async completeReserveWithdrawal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() executor: AuthenticatedUser,
  ) {
    return {
      data: await this.transactionsService.completeReserveWithdrawal(
        id,
        executor,
      ),
    };
  }
}
