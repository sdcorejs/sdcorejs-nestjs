# Feature overview

The package has three PostgreSQL-backed feature modules plus BullMQ integration.

| Feature | Enable | Primary API | HTTP controller |
| --- | --- | --- | --- |
| Uploaded files | `uploadedFile: {...}` | `UploadedFileService` | private opt-in |
| Action history | `actionHistory: {...}` | `ActionHistoryService` | private opt-in |
| Job scheduler | `jobScheduler: {}` | `JobSchedulerService` | none |
| BullMQ queue | `queue: {...}` or `QueueModule` | `Queue`, `SdWorkerHost` | none |

## Shared setup

Uploaded files, action history, and job scheduler export TypeORM entities from
`@sdcorejs/nestjs/features`. Register them with `autoLoadEntities: true` or list them explicitly,
then generate application migrations.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  uploadedFile: {
    driver: 'local',
    localRoot: './var/uploads',
    cleanupAfterDays: 7,
  },
  actionHistory: {
    authorizeRead: ({ context, tenantCode }) =>
      context.tenant === tenantCode &&
      context.permissions?.includes('history:read') === true,
  },
  jobScheduler: {},
  queue: {
    connection: { host: 'localhost', port: 6379, db: 1 },
    prefix: 'orders:dev:queue',
  },
});
```

## Security model

- [Uploaded files](/guide/uploaded-files) use tenant/department/owner scope, generated keys, bounded
  input, pending-first persistence, durable deletion, and non-enumerating responses.
- [Action history](/guide/action-history) binds reads to tenant + resource identity + explicit
  policy and recursively redacts secrets before persistence.
- [Job scheduler](/guide/job-scheduler) fences lease ownership but delegates external idempotency to
  a stable `lease.idempotencyKey`.
- [BullMQ](/guide/queue) provides durable work/retries but requires idempotent handlers.

The uploaded-file and action-history controllers are not auto-registered. Adding their classes to an
application module's `controllers` array explicitly exposes those authenticated routes.
