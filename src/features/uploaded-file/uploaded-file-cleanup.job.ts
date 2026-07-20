import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobSchedulerService } from '../job-scheduler/job-scheduler.service';
import { JobSchedulerType } from '../job-scheduler/types';
import { UploadedFileService } from './services/uploaded-file.service';
import { UPLOADED_FILE_CONFIG, type UploadedFileConfig } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_BATCH_SIZE = 100;
const MAX_RETRY_BATCHES_PER_RUN = 10;

/**
 * Daily 3 AM file maintenance. Durable pending object deletions are always retried. Age-based
 * cleanup of unused files (`isUsed = false`) runs only when `cleanupAfterDays` is configured.
 *
 * Schedule is a fixed `@Cron('0 3 * * *')` — the host MUST import `@nestjs/schedule`
 * `ScheduleModule.forRoot()` so the cron fires. When {@link JobSchedulerService} is available (the
 * consumer wired the job-scheduler feature) each run is guarded by a distributed DB lock so only
 * one instance purges per day; otherwise it runs directly.
 */
@Injectable()
export class UploadedFileCleanupJob {
  private readonly logger = new Logger(UploadedFileCleanupJob.name);

  constructor(
    private readonly uploadedFiles: UploadedFileService,
    @Inject(UPLOADED_FILE_CONFIG) private readonly config: UploadedFileConfig,
    @Optional() private readonly jobs?: JobSchedulerService,
  ) {}

  /** Runs daily at 03:00. Public so a host can also trigger a sweep manually. */
  @Cron('0 3 * * *')
  async tick(): Promise<void> {
    const days = this.config.cleanupAfterDays;
    const cleanupDays = typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : undefined;
    const runKey = new Date().toISOString().slice(0, 10);
    const run = () => this.purge(cleanupDays);
    if (this.jobs) {
      await this.jobs.runExclusive({ code: 'uploaded-file-orphan-cleanup', runKey, type: JobSchedulerType.SCHEDULE }, run);
    } else {
      await run();
    }
  }

  private async purge(days?: number): Promise<void> {
    let retried = 0;
    for (let batch = 0; batch < MAX_RETRY_BATCHES_PER_RUN; batch += 1) {
      const count = await this.uploadedFiles.unsafeSystemRetryPendingDeletions(RETRY_BATCH_SIZE);
      retried += count;
    }
    if (retried) this.logger.log(`Orphan cleanup: finalized ${retried} pending file deletions`);
    if (!days) return;
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const purged = await this.uploadedFiles.unsafeSystemPurgeUnusedBefore(cutoff);
    if (purged) this.logger.log(`Orphan cleanup: purged ${purged} unused files older than ${days}d`);
  }
}
