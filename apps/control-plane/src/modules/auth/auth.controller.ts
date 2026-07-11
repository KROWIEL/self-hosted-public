import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.auth.refresh(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setup2fa(@Request() req: { user: { id: string } }) {
    return this.auth.begin2fa(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('onboarding')
  onboarding(
    @Request() req: { user: { id: string } },
    @Body() dto: OnboardingDto,
  ) {
    return this.auth.completeOnboarding(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  changePassword(
    @Request() req: { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enable2fa(
    @Request() req: { user: { id: string } },
    @Body() dto: Enable2faDto,
  ) {
    return this.auth.enable2fa(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disable2fa(
    @Request() req: { user: { id: string } },
    @Body() dto: Disable2faDto,
  ) {
    return this.auth.disable2fa(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.auth.me(req.user.id);
  }
}
