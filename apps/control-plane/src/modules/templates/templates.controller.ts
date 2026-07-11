import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommonErrors } from '../../common/errors/app-errors';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

type AuthedReq = { user: { id: string; role: string } };

function assertAdmin(req: AuthedReq) {
  if (req.user.role !== 'ADMIN') throw CommonErrors.adminOnly();
}

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @Post()
  create(@Request() req: AuthedReq, @Body() dto: CreateTemplateDto) {
    assertAdmin(req);
    return this.templates.create(dto);
  }

  @Patch(':id')
  update(
    @Request() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    assertAdmin(req);
    return this.templates.update(id, dto);
  }

  @Delete(':id')
  remove(@Request() req: AuthedReq, @Param('id') id: string) {
    assertAdmin(req);
    return this.templates.remove(id);
  }
}
