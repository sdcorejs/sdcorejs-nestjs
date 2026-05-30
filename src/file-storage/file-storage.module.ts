import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsFileStorageService } from './aws.service';
import { LocalFileStorageService } from './local.service';
import { FILE_STORAGE_CONFIG, type FileStorageConfig, IFileStorageService } from './types';
import { UploadedFile } from './uploaded-file.entity';
import { UploadedFileService } from './uploaded-file.service';

/**
 * Provides {@link IFileStorageService} (S3 or local-disk driver) + {@link UploadedFileService}.
 *
 * Driver auto-detects: S3 when `accessId`+`accessKey`+`bucket` are set, else local disk. The S3
 * driver requires the optional peer dep `aws-sdk`. The consumer MUST register {@link UploadedFile}
 * in their TypeORM datasource `entities` array. No HTTP controller is provided — inject
 * `IFileStorageService` into your own controller to expose upload/download routes.
 *
 * @example
 * imports: [FileStorageModule.forRoot({ bucket: '...', accessId: '...', accessKey: '...', cdnBaseUrl: '...' })]
 * constructor(@Inject(IFileStorageService) private storage: IFileStorageService) {}
 */
@Module({})
export class FileStorageModule {
  static forRoot(config: FileStorageConfig): DynamicModule {
    const useS3 = config.driver === 's3' || (!!config.accessId && !!config.accessKey && !!config.bucket);
    const providers: Provider[] = [
      UploadedFileService,
      { provide: FILE_STORAGE_CONFIG, useValue: config },
      { provide: IFileStorageService, useClass: useS3 ? AwsFileStorageService : LocalFileStorageService },
    ];
    return {
      module: FileStorageModule,
      global: true,
      imports: [TypeOrmModule.forFeature([UploadedFile])],
      providers,
      exports: [IFileStorageService, UploadedFileService],
    };
  }
}
