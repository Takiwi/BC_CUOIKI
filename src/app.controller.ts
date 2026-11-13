import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database/database.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  @ApiOkResponse({ schema: { example: { data: { status: 'ok' } } } })
  async getHealth() {
    await this.database.query('SELECT 1');
    return { data: { status: 'ok' } };
  }
}
