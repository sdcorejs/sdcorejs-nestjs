import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobSchedulerService } from '../job-scheduler/job-scheduler.service';
import { JobSchedulerType } from '../job-scheduler/types';
import { UploadedFileService } from './services/uploaded-file.service';
import { UPLOADED_FILE_CONFIG, type UploadedFileConfig } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_BATCHES_PER_RUN = 10;
const PENDING_JOB_NAME = 'uploaded-file-pending-cleanup';
const TEMPORARY_JOB_NAME = 'uploaded-file-temporary-cleanup';

/**
 * Configurable pending and temporary file maintenance. Durable pending/deletion work is retried,
 * while ready temporary rows are independently claimed at their exact expiry boundary. Age-based
 * cleanup of unused legacy files runs only when `cleanupAfterDays` is configured.
 *
 * The host imports `ScheduleModule.forRoot()` so {@link SchedulerRegistry} is available. When
 * {@link JobSchedulerService} is present, each configured track also uses a distributed DB lock;
 * service-level compare-and-swap claims remain the multi-instance correctness boundary.
 */
@Injectable()
export class UploadedFileCleanupJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UploadedFileCleanupJob.name);

  constructor(
    private readonly uploadedFiles: UploadedFileService,
    @Inject(UPLOADED_FILE_CONFIG) private readonly config: UploadedFileConfig,
    @Optional() private readonly jobs?: JobSchedulerService,
    @Optional() private readonly scheduler?: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.scheduler) return;
    this.register(PENDING_JOB_NAME, this.config.pendingCleanupInterval ?? '0 3 * * *', () => this.pendingTick());
    this.register(TEMPORARY_JOB_NAME, this.config.temporaryCleanupInterval ?? '*/15 * * * *', () => this.temporaryTick());
  }

  onApplicationShutdown(): void {
    if (!this.scheduler) return;
    for (const name of [PENDING_JOB_NAME, TEMPORARY_JOB_NAME]) {
      try {
        this.scheduler.deleteCronJob(name);
      } catch {
        // A partially initialized ScheduleModule may not contain either job.
      }
    }
  }

  private register(name: string, expression: string, callback: () => Promise<void>): void {
    if (!this.scheduler) return;
    const job = CronJob.from({
      cronTime: expression,
      onTick: () => void callback().catch(() => this.logger.error(`${name} run failed`)),
      start: false,
    });
    this.scheduler.addCronJob(name, job);
    job.start();
  }

  /** Public manual entry point that runs both maintenance tracks. */
  async tick(): Promise<void> {
    await this.pendingTick();
    await this.temporaryTick();
  }

  async pendingTick(): Promise<void> {
    const days = this.config.cleanupAfterDays;
    const cleanupDays = typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : undefined;
    const runKey = new Date().toISOString().slice(0, 16);
    const run = () => this.purge(cleanupDays);
    if (this.jobs) {
      await this.jobs.runExclusive({ code: PENDING_JOB_NAME, runKey, type: JobSchedulerType.SCHEDULE }, run);
    } else {
      await run();
    }
  }

  async temporaryTick(): Promise<void> {
    const runKey = new Date().toISOString().slice(0, 16);
    const run = async () => {
      const expired = await this.uploadedFiles.cleanupExpiredTemporaryFiles(new Date(), this.config.cleanupBatchSize ?? 100);
      if (expired) this.logger.log(`Temporary cleanup: purged ${expired} expired files`);
    };
    if (this.jobs) {
      await this.jobs.runExclusive({ code: TEMPORARY_JOB_NAME, runKey, type: JobSchedulerType.SCHEDULE }, run);
    } else {
      await run();
    }
  }

  private async purge(days?: number): Promise<void> {
    let retried = 0;
    for (let batch = 0; batch < MAX_RETRY_BATCHES_PER_RUN; batch += 1) {
      const count = await this.uploadedFiles.cleanupPendingUploads(this.config.cleanupBatchSize ?? 100);
      retried += count;
    }
    if (retried) this.logger.log(`Orphan cleanup: finalized ${retried} pending file deletions`);
    if (!days) return;
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const purged = await this.uploadedFiles.unsafeSystemPurgeUnusedBefore(cutoff);
    if (purged) this.logger.log(`Orphan cleanup: purged ${purged} unused files older than ${days}d`);
  }
}
