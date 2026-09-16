import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectSchema,
  ProjectUpdateSchema,
  zPaginated,
  type Paginated,
  type Project,
  type ProjectCreate,
  type ProjectListQuery,
  type ProjectUpdate,
} from '@app/contracts';
import { z } from 'zod';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, type OrgContext } from '../../auth/org-context';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { ProjectsService } from './projects.service';

/**
 * The reference feature controller.
 *
 * Every handler takes the tenant from @CurrentOrg() — resolved by PermissionsGuard
 * from the session — and never from a path parameter or the body. `:id` identifies a
 * row *within* the caller's organization; an id from another tenant resolves to 404.
 */
@ApiTags('projects')
@ApiStandardErrors()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  @ApiOperation({ summary: 'List the projects of the active organization' })
  @ApiEnvelope(zPaginated(ProjectSchema))
  list(
    @CurrentOrg() org: OrgContext,
    @Query({ schema: ProjectListQuerySchema }) query: ProjectListQuery,
  ): Promise<Paginated<Project>> {
    return this.projects.list(org, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  @ApiOperation({ summary: 'Read one project' })
  @ApiEnvelope(ProjectSchema)
  getById(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<Project> {
    return this.projects.getById(org, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROJECTS_MANAGE)
  @ApiOperation({ summary: 'Create a project' })
  @ApiEnvelope(ProjectSchema, { status: HttpStatus.CREATED })
  create(
    @CurrentOrg() org: OrgContext,
    @Body({ schema: ProjectCreateSchema }) body: ProjectCreate,
  ): Promise<Project> {
    return this.projects.create(org, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PROJECTS_MANAGE)
  @ApiOperation({ summary: 'Update a project' })
  @ApiEnvelope(ProjectSchema)
  update(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: ProjectUpdateSchema }) body: ProjectUpdate,
  ): Promise<Project> {
    return this.projects.update(org, id, body);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PROJECTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  remove(
    @CurrentOrg() org: OrgContext,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<void> {
    return this.projects.remove(org, id);
  }
}
