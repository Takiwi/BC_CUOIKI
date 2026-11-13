import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Lấy thống kê tổng quan toàn bộ entities trong cơ sở dữ liệu',
  })
  async getOverviewStats() {
    return { data: await this.adminService.getOverviewStats() };
  }

  @Get('entities')
  @ApiOperation({
    summary: 'Lấy danh sách cấu hình các entities hỗ trợ quản lý',
  })
  getEntityConfigList() {
    return { data: this.adminService.getEntityConfigList() };
  }

  @Get('entities/:entity')
  @ApiOperation({ summary: 'Lấy danh sách dữ liệu phân trang của một entity' })
  async getEntityData(
    @Param('entity') entity: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'ASC' | 'DESC',
    @Query('search') search?: string,
  ) {
    return {
      data: await this.adminService.getEntityData(entity, {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        sort,
        order,
        search,
      }),
    };
  }

  @Get('entities/:entity/:id')
  @ApiOperation({ summary: 'Xem chi tiết một bản ghi theo ID' })
  async getEntityRecord(
    @Param('entity') entity: string,
    @Param('id') id: string,
  ) {
    return { data: await this.adminService.getEntityRecord(entity, id) };
  }

  @Patch('entities/:entity/:id')
  @ApiOperation({ summary: 'Cập nhật trường dữ liệu cho phép của một entity' })
  async updateEntityRecord(
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Body() updates: Record<string, unknown>,
  ) {
    return {
      data: await this.adminService.updateEntityRecord(entity, id, updates),
    };
  }

  @Delete('entities/:entity/:id')
  @ApiOperation({ summary: 'Xóa bản ghi của một entity' })
  async deleteEntityRecord(
    @Param('entity') entity: string,
    @Param('id') id: string,
  ) {
    return { data: await this.adminService.deleteEntityRecord(entity, id) };
  }
}
