import { Global, Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { ProjectResolver } from './project-resolver.service';
import { ProjectRolesGuard } from '../../common/rbac/project-roles.guard';
import { MembersController } from './members.controller';

/**
 * Global so any module can inject MembersService/ProjectResolver (and use the
 * ProjectRolesGuard) without re-importing. Auth/DB modules are already global.
 */
@Global()
@Module({
  providers: [MembersService, ProjectResolver, ProjectRolesGuard],
  controllers: [MembersController],
  exports: [MembersService, ProjectResolver, ProjectRolesGuard],
})
export class MembersModule {}
