import { Inject, Injectable } from '@nestjs/common';
import { file, type Database } from '@app/db';
import { TenantRepository } from '../../database/tenant.repository';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class FilesRepository extends TenantRepository<typeof file> {
  constructor(@Inject(DRIZZLE) db: Database) {
    super(db, file);
  }
}
