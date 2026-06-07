export * from './action-history.entity';
export * from './job-scheduler.entity';

import { ActionHistory } from './action-history.entity';
import { JobScheduler } from './job-scheduler.entity';

/**
 * Every concrete TypeORM entity shipped by `@sdcorejs/nestjs`. Spread into your DataSource's
 * `entities` array to register all library tables at once.
 */
export const SD_CORE_ENTITIES = [ActionHistory, JobScheduler] as const;
