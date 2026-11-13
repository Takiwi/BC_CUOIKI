import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedRequest } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiCreatedResponse({
    schema: {
      example: {
        data: {
          id: 'uuid',
          email: 'member@example.com',
          applicationStatus: 'PENDING',
        },
      },
    },
  })
  async register(@Body() input: RegisterDto) {
    return { data: await this.authService.register(input) };
  }

  @Post('login')
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          member: { id: 'uuid', role: 'MEMBER' },
        },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto) {
    return { data: await this.authService.login(input) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() input: RefreshTokenDto) {
    return { data: await this.authService.refresh(input.refreshToken) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() input: RefreshTokenDto) {
    return { data: await this.authService.logout(input.refreshToken) };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return { data: this.authService.getCurrentUser(request.user) };
  }
}
