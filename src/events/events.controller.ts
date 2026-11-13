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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Liệt kê sự kiện và số người đăng ký' })
  async findAll() {
    return { data: await this.eventsService.findAll() };
  }

  @Get(':id/registrations/me')
  @Roles('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
  @ApiOperation({ summary: 'Lấy trạng thái đăng ký sự kiện của bản thân' })
  async getMyRegistration(
    @Param('id', new ParseUUIDPipe()) eventId: string,
    @CurrentUser() member: AuthenticatedUser,
  ) {
    return {
      data: await this.eventsService.getMyRegistration(eventId, member),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết sự kiện và số người đăng ký' })
  async findById(@Param('id', new ParseUUIDPipe()) eventId: string) {
    return { data: await this.eventsService.findById(eventId) };
  }

  @Post()
  @Roles('PRESIDENT', 'BOARD')
  @ApiOperation({ summary: 'Tạo sự kiện (President / Board)' })
  @ApiCreatedResponse()
  async create(
    @Body() input: CreateEventDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.eventsService.create(input, actor) };
  }

  @Patch(':id')
  @Roles('PRESIDENT', 'BOARD')
  @ApiOperation({ summary: 'Cập nhật sự kiện (President / Board)' })
  @ApiOkResponse()
  async update(
    @Param('id', new ParseUUIDPipe()) eventId: string,
    @Body() input: UpdateEventDto,
  ) {
    return { data: await this.eventsService.update(eventId, input) };
  }

  @Delete(':id')
  @Roles('PRESIDENT', 'BOARD')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xóa sự kiện chưa bắt đầu (President / Board)',
  })
  async remove(@Param('id', new ParseUUIDPipe()) eventId: string) {
    return { data: await this.eventsService.remove(eventId) };
  }

  @Post(':id/registrations')
  @Roles('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
  @ApiOperation({ summary: 'Đăng ký tham gia sự kiện' })
  async register(
    @Param('id', new ParseUUIDPipe()) eventId: string,
    @CurrentUser() member: AuthenticatedUser,
  ) {
    return { data: await this.eventsService.register(eventId, member) };
  }

  @Delete(':id/registrations/me')
  @Roles('MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy đăng ký của bản thân khỏi sự kiện' })
  async cancelRegistration(
    @Param('id', new ParseUUIDPipe()) eventId: string,
    @CurrentUser() member: AuthenticatedUser,
  ) {
    return {
      data: await this.eventsService.cancelRegistration(eventId, member),
    };
  }
}
