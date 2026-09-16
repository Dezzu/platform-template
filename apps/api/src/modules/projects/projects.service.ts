import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type Paginated,
  type Project,
  type ProjectCreate,
  type ProjectListQuery,
  type ProjectUpdate,
} from '@app/contracts';
import { project as projectTable, type Database } from '@app/db';
import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { AppException } from '../../common';
import { AuditService } from '../audit/audit.service';
import { DRIZZLE } from '../../database/database.module';
import type { OrgContext } from '../../auth/org-context';
import { ProjectsRepository } from './projects.repository';

type ProjectRow = typeof projectTable.$inferSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly repository: ProjectsRepository,
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async list(ctx: OrgContext, query: ProjectListQuery): Promise<Paginated<Project>> {
    const filters: (SQL | undefined)[] = [
      query.status ? eq(projectTable.status, query.status) : undefined,
      query.q ? ilike(projectTable.name, `%${query.q}%`) : undefined,
    ];
    const where = and(...filters.filter((f): f is SQL => f !== undefined));

    const column = query.sort === 'name' ? projectTable.name : projectTable.createdAt;
    const orderBy = query.dir === 'asc' ? asc(column) : desc(column);

    const [rows, total] = await Promise.all([
      this.repository.findMany(ctx, {
        ...(where ? { where } : {}),
        orderBy,
        limit: query.size,
        offset: query.page * query.size,
      }),
      this.repository.count(ctx, where),
    ]);

    return {
      items: rows.map(toDto),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  async getById(ctx: OrgContext, id: string): Promise<Project> {
    const row = await this.repository.findById(ctx, id);
    // A row belonging to another organization is indistinguishable from a missing one,
    // which is deliberate: a 403 here would confirm that the id exists.
    if (!row) throw AppException.notFound('Project');
    return toDto(row);
  }

  async create(ctx: OrgContext, input: ProjectCreate): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const existing = await this.repository.findMany(
        ctx,
        { where: eq(projectTable.name, input.name), limit: 1 },
        tx,
      );
      if (existing.length > 0) {
        throw AppException.conflict(
          `A project named "${input.name}" already exists`,
          ERROR_CODES.CONFLICT,
        );
      }

      const row = await this.repository.insert(
        ctx,
        {
          name: input.name,
          description: input.description ?? null,
          status: input.status ?? 'active',
          createdByUserId: ctx.userId,
        },
        tx,
      );

      // Same transaction as the change it describes: a rolled-back insert must not
      // leave an audit entry claiming the project was created.
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          impersonatorUserId: ctx.impersonatorUserId,
          action: 'project.created',
          resourceType: 'project',
          resourceId: row.id,
          after: toDto(row),
        },
        tx,
      );

      return toDto(row);
    });
  }

  async update(ctx: OrgContext, id: string, input: ProjectUpdate): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const before = await this.repository.findById(ctx, id, tx);
      if (!before) throw AppException.notFound('Project');

      const row = await this.repository.update(
        ctx,
        id,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.status === undefined ? {} : { status: input.status }),
          updatedAt: new Date(),
        },
        tx,
      );
      if (!row) throw AppException.notFound('Project');

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          impersonatorUserId: ctx.impersonatorUserId,
          action: 'project.updated',
          resourceType: 'project',
          resourceId: id,
          before: toDto(before),
          after: toDto(row),
        },
        tx,
      );

      return toDto(row);
    });
  }

  async remove(ctx: OrgContext, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.repository.delete(ctx, id, tx);
      if (!row) throw AppException.notFound('Project');

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          impersonatorUserId: ctx.impersonatorUserId,
          action: 'project.deleted',
          resourceType: 'project',
          resourceId: id,
          before: toDto(row),
        },
        tx,
      );
    });
  }
}

function toDto(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
