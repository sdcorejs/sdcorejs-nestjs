import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobSchedulerService, JobSchedulerType } from '@sdcorejs/nestjs/features';
import { CatalogSourceClient } from '../integrations/catalog-source.client';
import { TransactionalOutbox } from '../outbox/transactional-outbox';

const ONE_MINUTE_MS = 60_000;

@Injectable()
export class CatalogSyncJob {
  private readonly logger = new Logger(CatalogSyncJob.name);

  constructor(
    private readonly jobs: JobSchedulerService,
    private readonly source: CatalogSourceClient,
    private readonly outbox: TransactionalOutbox,
  ) {}

  @Cron('0 * * * * *')
  async run(): Promise<void> {
    const scheduledFor = new Date(Math.floor(Date.now() / ONE_MINUTE_MS) * ONE_MINUTE_MS).toISOString();
    const execution = await this.jobs.runExclusive(
      {
        code: 'catalog-sync',
        name: 'Fetch the catalog snapshot once per scheduled minute',
        type: JobSchedulerType.SCHEDULE,
        runKey: scheduledFor,
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      },
      async (lease) => {
        const snapshot = await this.source.fetchSnapshot();
        const enqueued = await this.outbox.enqueueOnce(lease.idempotencyKey, {
          topic: 'catalog.snapshot.received',
          payload: {
            scheduledFor,
            revision: snapshot.revision,
            itemCount: snapshot.itemCount,
          },
        });
        return { enqueued, revision: snapshot.revision };
      },
    );

    if (!execution.acquired) this.logger.debug(`Catalog sync already claimed for ${scheduledFor}`);
  }
}
