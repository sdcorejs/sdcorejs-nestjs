import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobScheduler } from '../entities/job-scheduler.entity';
import { JobSchedulerService } from './job-scheduler.service';

export interface JobSchedulerModuleOptions {
  /** Register globally so `JobSchedulerService` injects anywhere. Default `true`. */
  global?: boolean;
}

/**
 * Provides {@link JobSchedulerService} (distributed cron lock). The consumer MUST register
 * {@link JobScheduler} in their TypeORM datasource `entities` array (the unique `lockKey` index
 * is what enforces single-winner execution).
 */
@Module({})
export class JobSchedulerModule {
  static forRoot(options: JobSchedulerModuleOptions = {}): DynamicModule {
    return {
      module: JobSchedulerModule,
      global: options.global !== false,
      imports: [TypeOrmModule.forFeature([JobScheduler])],
      providers: [JobSchedulerService],
      exports: [JobSchedulerService],
    };
  }
}
