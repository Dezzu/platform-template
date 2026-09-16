import { Inject, Injectable } from '@nestjs/common';
import { project, type Database } from '@app/db';
import { TenantRepository } from '../../database/tenant.repository';
import { DRIZZLE } from '../../database/database.module';

/**
 * Nothing to add beyond the base class for a plain CRUD feature — which is the point.
 * Extending TenantRepository is what makes every query organization-scoped by
 * construction.
 */
@Injectable()
export class ProjectsRepository extends TenantRepository<typeof project> {
  constructor(@Inject(DRIZZLE) db: Database) {
    super(db, project);
  }
}
