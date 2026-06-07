import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsUploadedFileStorage } from './services/aws.service';
import { LocalUploadedFileStorage } from './services/local.service';
import { UPLOADED_FILE_CONFIG, type UploadedFileConfig, IUploadedFileStorage } from './types';
import { UploadedFile } from './uploaded-file.entity';
import { UploadedFileService } from './services/uploaded-file.service';

/**
 * Provides {@link IUploadedFileStorage} (S3 or local-disk driver) + {@link UploadedFileService}.
 *
 * Driver auto-detects: S3 when `accessId`+`accessKey`+`bucket` are set, else local disk. The S3
 * driver requires the optional peer dep `aws-sdk`. The consumer MUST register {@link UploadedFile}
 * in their TypeORM datasource `entities` array. No HTTP controller is provided — inject
 * `IUploadedFileStorage` into your own controller to expose upload/download routes.
 *
 * @example
 * imports: [UploadedFileModule.forRoot({ bucket: '...', accessId: '...', accessKey: '...', cdnBaseUrl: '...' })]
 * constructor(@Inject(IUploadedFileStorage) private storage: IUploadedFileStorage) {}
 */
@Module({})
export class UploadedFileModule {
  static forRoot(config: UploadedFileConfig): DynamicModule {
    const useS3 = config.driver === 's3' || (!!config.accessId && !!config.accessKey && !!config.bucket);
    const providers: Provider[] = [
      UploadedFileService,
      { provide: UPLOADED_FILE_CONFIG, useValue: config },
      { provide: IUploadedFileStorage, useClass: useS3 ? AwsUploadedFileStorage : LocalUploadedFileStorage },
    ];
    return {
      module: UploadedFileModule,
      global: true,
      imports: [TypeOrmModule.forFeature([UploadedFile])],
      providers,
      exports: [IUploadedFileStorage, UploadedFileService],
    };
  }
}
