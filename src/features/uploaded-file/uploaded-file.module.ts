import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { normalizeUploadedFileConfig } from './config';
import { AwsUploadedFileStorage } from './services/aws.service';
import { LocalUploadedFileStorage } from './services/local.service';
import { UploadedFileService } from './services/uploaded-file.service';
import { UPLOADED_FILE_STORAGE_DRIVER } from './storage-driver';
import { UPLOADED_FILE_CONFIG, type UploadedFileConfig } from './types';
import { UploadedFileCleanupJob } from './uploaded-file-cleanup.job';
import { UploadedFile } from './uploaded-file.entity';

/**
 * Provides the authorized {@link UploadedFileService}. Raw storage drivers stay internal so callers
 * cannot bypass tenant/owner checks by passing arbitrary object keys.
 *
 * Driver auto-detects S3 when a complete explicit credential pair is present; otherwise it uses
 * local disk. Explicit S3 also supports the AWS default credential chain. Invalid credentials and
 * missing S3 buckets fail during module registration.
 * The consumer registers {@link UploadedFile} in its TypeORM datasource and may opt into the
 * drop-in controller separately. The maintenance provider is always registered so durable pending,
 * staging, deletion, and temporary-expiry work can retry; the host imports
 * `ScheduleModule.forRoot()` to activate its configured cron tracks.
 *
 * @example
 * imports: [UploadedFileModule.forRoot({ driver: 's3', bucket: '...', region: 'ap-southeast-1' })]
 * constructor(private uploads: UploadedFileService) {}
 */
@Module({})
export class UploadedFileModule {
  static forRoot(config: UploadedFileConfig): DynamicModule {
    const normalizedConfig = normalizeUploadedFileConfig(config);
    const useS3 = normalizedConfig.driver === 's3';
    const providers: Provider[] = [
      UploadedFileService,
      UploadedFileCleanupJob,
      { provide: UPLOADED_FILE_CONFIG, useValue: normalizedConfig },
      { provide: UPLOADED_FILE_STORAGE_DRIVER, useClass: useS3 ? AwsUploadedFileStorage : LocalUploadedFileStorage },
    ];
    return {
      module: UploadedFileModule,
      global: true,
      imports: [TypeOrmModule.forFeature([UploadedFile])],
      providers,
      exports: [UploadedFileService],
    };
  }
}
