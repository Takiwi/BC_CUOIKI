import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovalDto } from './dto/approval.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ProposalFiltersDto } from './dto/proposal-filters.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { VoteDto } from './dto/vote.dto';
import { ProposalsService } from './proposals.service';

@ApiTags('proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('funds/proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post()
  @Roles('MEMBER', 'PRESIDENT', 'TREASURER')
  @ApiOperation({ summary: 'Tạo đề xuất chi và bắt đầu vòng biểu quyết' })
  @ApiCreatedResponse()
  async create(
    @Body() input: CreateProposalDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.proposalsService.create(input, actor) };
  }

  @Get()
  @ApiOperation({ summary: 'Liệt kê đề xuất chi theo bộ lọc' })
  async findAll(@Query() filters: ProposalFiltersDto) {
    return { data: await this.proposalsService.findAll(filters) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết đề xuất chi' })
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.proposalsService.findById(id) };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Người tạo sửa đề xuất khi chưa có phiếu trong vòng hiện tại',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateProposalDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.proposalsService.update(id, input, actor) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Người tạo hủy đề xuất chưa được duyệt, giữ lại lịch sử',
  })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.proposalsService.cancel(id, actor) };
  }

  @Patch(':id/approve')
  @Roles('TREASURER', 'BOARD')
  @ApiOperation({ summary: 'Duyệt cuối đề xuất đã vượt qua biểu quyết' })
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ApprovalDto,
    @CurrentUser() reviewer: AuthenticatedUser,
  ) {
    return { data: await this.proposalsService.approve(id, input, reviewer) };
  }

  @Patch(':id/board-decision')
  @Roles('BOARD')
  @ApiOperation({
    summary: 'Ban chủ nhiệm chốt proposal sau hai vòng biểu quyết hòa',
  })
  async decideAfterTie(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ApprovalDto,
    @CurrentUser() reviewer: AuthenticatedUser,
  ) {
    return {
      data: await this.proposalsService.decideAfterTie(id, input, reviewer),
    };
  }
}

@ApiTags('ballots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ballots')
export class BallotsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Get(':proposalId')
  @ApiOperation({ summary: 'Lấy vòng biểu quyết và danh sách snapshot' })
  async getBallot(
    @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
  ) {
    return { data: await this.proposalsService.getBallot(proposalId) };
  }

  @Post(':proposalId/votes')
  @Roles('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
  @ApiOperation({ summary: 'Bỏ phiếu theo snapshot của vòng hiện tại' })
  async vote(
    @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
    @Body() input: VoteDto,
    @CurrentUser() voter: AuthenticatedUser,
  ) {
    return {
      data: await this.proposalsService.castVote(proposalId, input, voter),
    };
  }

  @Get(':proposalId/results')
  @ApiOperation({ summary: 'Xem kết quả và người chưa bỏ phiếu' })
  async getResults(
    @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
  ) {
    return { data: await this.proposalsService.getBallot(proposalId) };
  }
}
