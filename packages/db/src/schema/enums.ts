import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums, named `<table>_<column>`. Kept in one file so the set is easy to
 * review — adding a value is a migration, removing one is a breaking change.
 */
export const projectStatus = pgEnum('project_status', ['active', 'archived']);
