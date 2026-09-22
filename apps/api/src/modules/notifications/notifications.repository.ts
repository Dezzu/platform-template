import { Inject, Injectable } from '@nestjs/common';
import { notification, type Database } from '@app/db';
import { DRIZZLE } from '../../database/database.module';
import { TenantRepository } from '../../database/tenant.repository';

/**
 * Scoped to the organization like every domain table — and the scope matters more
 * here than usual: the same account can belong to several tenants, and what happened
 * in one is not theirs to see while working in another.
 */
@Injectable()
export class NotificationsRepository extends TenantRepository<typeof notification> {
  constructor(@Inject(DRIZZLE) db: Database) {
    super(db, notification);
  }
}
