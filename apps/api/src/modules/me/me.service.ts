import { Inject, Injectable } from '@nestjs/common';
import { type Database, user } from '@app/db';
import { type UpdateProfile, type UserProfile } from '@app/contracts';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';
import { AppException } from '../../common';

@Injectable()
export class MeService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async updateProfile(userId: string, input: UpdateProfile): Promise<UserProfile> {
    const [row] = await this.db
      .update(user)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.image === undefined ? {} : { image: input.image }),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
      .returning();

    // The session said this user exists, so a miss means the row was deleted
    // mid-request — a real 404, not a validation problem.
    if (!row) throw AppException.notFound('User');

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      emailVerified: row.emailVerified,
      twoFactorEnabled: row.twoFactorEnabled ?? false,
    };
  }
}
