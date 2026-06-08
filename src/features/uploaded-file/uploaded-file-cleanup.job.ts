import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import type { Repository } from 'typeorm';
import { JobSchedulerService } from '../job-scheduler/job-scheduler.service';
import { JobSchedulerType } from '../job-scheduler/types';
import { UploadedFile } from './uploaded-file.entity';
import { IUploadedFileStorage, UPLOADED_FILE_CONFIG, type UploadedFileConfig } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily 3 AM orphan-file cleanup: storage-purges (and removes the rows for) uploaded files that
 * were never attached (`isUsed = false`) and are older than `cleanupAfterDays`. Registered by
 * {@link UploadedFileModule} ONLY when `cleanupAfterDays` is configured (`> 0`); otherwise no
 * cleanup runs and this provider is never created.
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
    @InjectRepository(UploadedFile) private readonly repository: Repository<UploadedFile>,
    @Inject(IUploadedFileStorage) private readonly storage: IUploadedFileStorage,
    @Inject(UPLOADED_FILE_CONFIG) private readonly config: UploadedFileConfig,
    @Optional() private readonly jobs?: JobSchedulerService,
  ) {}

  /** Runs daily at 03:00. Public so a host can also trigger a sweep manually. */
  @Cron('0 3 * * *')
  async tick(): Promise<void> {
    const days = this.config.cleanupAfterDays;
    if (!days || days <= 0) return; // cleanup disabled
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const runKey = cutoff.toISOString().slice(0, 10);
    const run = () => this.purge(cutoff, days);
    if (this.jobs) {
      await this.jobs.runExclusive({ code: 'uploaded-file-orphan-cleanup', runKey, type: JobSchedulerType.SCHEDULE }, run);
    } else {
      await run();
    }
  }

  private async purge(cutoff: Date, days: number): Promise<void> {
    const orphans = await this.repository
      .createQueryBuilder('f')
      .where('f."deletedAt" IS NULL AND f."isUsed" = :used AND f."createdAt" < :cutoff', { used: false, cutoff })
      .getMany();
    if (!orphans.length) return;
    await this.storage.changeFiles(
      orphans.map((o) => o.cdn),
      [],
    );
    this.logger.log(`Orphan cleanup: purged ${orphans.length} unused files older than ${days}d`);
  }
}
