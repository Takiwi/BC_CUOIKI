import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateContributionDto } from './dto/create-contribution.dto';
import { FundsService } from './funds.service';

const FINANCIAL_VIEW_ROLES = [
  'MEMBER',
  'BOARD',
  'TREASURER',
  'PRESIDENT',
] as const;

interface OptionalAuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@ApiTags('funds')
@Controller('funds')
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCIAL_VIEW_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem số dư quỹ chính, quỹ dự phòng và ngưỡng' })
  async getBalances() {
    return { data: await this.fundsService.getBalances() };
  }

  @Post('contributions')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Đóng góp vào các quỹ theo quy tắc tự phân bổ' })
  @ApiCreatedResponse()
  async contribute(
    @Body() input: CreateContributionDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return {
      data: await this.fundsService.recordContribution(input, request.user),
    };
  }

  @Get('reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...FINANCIAL_VIEW_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem báo cáo tài chính tổng hợp, không định danh' })
  async getReport() {
    return { data: await this.fundsService.getReport() };
  }
}
