import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { GitService } from './git.service';

class CreateGitCredentialDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['GITHUB', 'GITLAB'])
  provider: 'GITHUB' | 'GITLAB';

  @IsOptional()
  @IsString()
  username?: string;

  @IsString()
  @MinLength(1)
  pat: string;
}

// Global git credentials (PATs) are platform-admin only.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('git-credentials')
export class GitController {
  constructor(private readonly git: GitService) {}

  @Get()
  list() {
    return this.git.list();
  }

  @Post()
  create(@Body() dto: CreateGitCredentialDto) {
    return this.git.create(dto);
  }

  @Post(':id/verify')
  verify(@Param('id') id: string, @Body('repoUrl') repoUrl: string) {
    return this.git.verify(id, repoUrl);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.git.remove(id);
  }
}
