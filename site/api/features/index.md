# Features API

Import path: `@sdcorejs/nestjs/features`

These opt-in stateful features require their exported entities in the application's TypeORM
datasource:

- [Uploaded files](./uploaded-files.md) — tenant/owner-authorized local/S3 storage with durable
  pending cleanup.
- [Action history](./action-history.md) — tenant-scoped, redacted before/after snapshots.
- [Job scheduler](./job-scheduler.md) — PostgreSQL distributed leases with fenced ownership and a
  stable logical-run idempotency key.

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  entities: [UploadedFile, ActionHistory, JobScheduler],
});
```

```ts
import {
  ActionHistoryModule,
  JobSchedulerModule,
  UploadedFileModule,
} from '@sdcorejs/nestjs/features';
```

`SdCoreModule.forRoot` wires each feature only when its corresponding option is present. The
optional `UploadedFileController` and `ActionHistoryController` are not registered automatically;
add them to an application module only when their drop-in HTTP surface matches your policy.

All three features use PostgreSQL-specific schema/query behavior. Apply migrations for their
entities before enabling the providers.
