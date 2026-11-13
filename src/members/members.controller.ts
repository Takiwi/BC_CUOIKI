import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ApprovalDto } from './dto/approval.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @Roles('PRESIDENT', 'BOARD', 'TREASURER')
  @ApiOperation({
    summary: 'Liệt kê danh sách thành viên (President, Board, Treasurer)',
  })
  async findAll() {
    return {
      data: await this.membersService.findAll(),
    };
  }

  @Get('applications')
  @Roles('PRESIDENT', 'BOARD')
  @ApiOperation({
    summary: 'Danh sách đơn đăng ký thành viên (President, Board)',
  })
  async findApplications() {
    return {
      data: await this.membersService.findApplications(),
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Thành viên tự cập nhật hồ sơ cá nhân' })
  async updateMyProfile(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() input: UpdateProfileDto,
  ) {
    return {
      data: await this.membersService.updateProfile(currentUser.id, input),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Xem chi tiết hồ sơ thành viên (Member chỉ xem của mình; President/Board/Treasurer xem tất cả)',
  })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return {
      data: await this.membersService.findById(id, currentUser),
    };
  }

  @Patch(':id/approval')
  @Roles('PRESIDENT')
  @ApiOperation({
    summary: 'Chủ tịch duyệt hoặc từ chối đơn đăng ký thành viên',
  })
  async decideApplication(
    @Param('id', new ParseUUIDPipe()) memberId: string,
    @Body() input: ApprovalDto,
    @CurrentUser() president: AuthenticatedUser,
  ) {
    return {
      data: await this.membersService.decideApplication(
        memberId,
        input.decision,
        input.reason,
        president,
      ),
    };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary:
      'Vô hiệu hóa hoặc kích hoạt tài khoản / Thành viên rời CLB (President hoặc chính bản thân)',
  })
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) memberId: string,
    @Body() input: UpdateStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return {
      data: await this.membersService.updateStatus(
        memberId,
        input.isActive,
        currentUser,
      ),
    };
  }
}
