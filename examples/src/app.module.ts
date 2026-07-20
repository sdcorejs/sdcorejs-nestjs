import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { CacheInterceptor } from '@sdcorejs/nestjs/services';
import { DEFAULT_QUEUE_PREFIX } from '@sdcorejs/nestjs/queue';
import type { Catalogs } from '@sdcorejs/nestjs/i18n';
import { ActionHistory, JobScheduler, UploadedFile, type UploadedFileConfig } from '@sdcorejs/nestjs/features';
import { ProductController } from './catalog/product.controller';
import { Product } from './catalog/product.entity';
import { ProductRepository } from './catalog/product.repository';
import { appConfig } from './config';
import { CatalogSourceClient } from './integrations/catalog-source.client';
import { CatalogSyncJob } from './jobs/catalog-sync.job';
import { OutboxMessage } from './outbox/outbox.entity';
import { PostgresTransactionalOutbox, TransactionalOutbox } from './outbox/transactional-outbox';
import { AppPermissionStrategy, AppTenancyStrategy, mapKeycloakPrincipal } from './security';

const catalogs: Catalogs = {
  en: {
    'catalog.product.not-found': 'Product not found',
  },
  vi: {
    'catalog.product.not-found': 'Không tìm thấy sản phẩm',
  },
};

const uploadedFile: UploadedFileConfig =
  appConfig.upload.driver === 's3'
    ? {
        driver: 's3',
        bucket: appConfig.upload.bucket,
        region: appConfig.upload.region,
        host: appConfig.appOrigin,
        cleanupAfterDays: 7,
        resolveScope: (context) => ({ tenantCode: context.tenant, userId: context.userId }),
        authorizationPolicy: ({ operation, context }) =>
          operation === 'read' && context.permissions?.includes('uploaded_file:read-tenant') ? 'tenant' : 'owner',
      }
    : {
        driver: 'local',
        localRoot: appConfig.upload.localRoot,
        host: appConfig.appOrigin,
        cleanupAfterDays: 7,
        resolveScope: (context) => ({ tenantCode: context.tenant, userId: context.userId }),
        authorizationPolicy: ({ operation, context }) =>
          operation === 'read' && context.permissions?.includes('uploaded_file:read-tenant') ? 'tenant' : 'owner',
      };

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: appConfig.database.url,
      ssl: appConfig.database.ssl,
      synchronize: appConfig.database.synchronize,
      autoLoadEntities: true,
      entities: [Product, OutboxMessage, UploadedFile, ActionHistory, JobScheduler],
    }),
    ScheduleModule.forRoot(),
    SdCoreModule.forRoot({
      context: {
        identity: { principalResolver: mapKeycloakPrincipal },
      },
      tenancy: { strategy: AppTenancyStrategy },
      permission: { strategy: AppPermissionStrategy },
      jwt: {
        issuer: appConfig.keycloak.issuer,
        audience: appConfig.keycloak.audience,
        jwks: { allowedIssuers: [appConfig.keycloak.issuer] },
      },
      cache: {
        backend: 'redis',
        fallbackToMemory: false,
        operationTimeoutMs: 1_000,
        redis: {
          host: appConfig.redis.host,
          port: appConfig.redis.port,
          password: appConfig.redis.password,
          db: appConfig.redis.cacheDb,
          keyPrefix: 'sdcore-example:cache:',
        },
      },
      http: {
        baseURL: appConfig.upstreamOrigin,
        trustedOrigins: [appConfig.upstreamOrigin],
        timeout: 10_000,
      },
      i18n: {
        catalogs,
        supportedLanguages: ['en', 'vi'],
        fallbackLanguage: 'en',
      },
      uploadedFile,
      actionHistory: {
        resolveActor: (context) => ({
          userId: context.userId,
          username: context.getCustom<string>('username'),
          fullName: context.getCustom<string>('fullName'),
        }),
        authorizeRead: ({ context, tenantCode }) =>
          context.tenant === tenantCode && context.permissions?.includes('action_history:read') === true,
        redactFields: ['accessToken', 'refreshToken', 'password'],
        maxPageSize: 100,
        retentionDays: 365,
      },
      jobScheduler: { global: true },
      queue: {
        connection: {
          host: appConfig.redis.host,
          port: appConfig.redis.port,
          password: appConfig.redis.password,
          db: appConfig.redis.queueDb,
        },
        prefix: `${DEFAULT_QUEUE_PREFIX}:example`,
      },
    }),
  ],
  controllers: [ProductController],
  providers: [
    ProductRepository,
    CatalogSourceClient,
    CatalogSyncJob,
    PostgresTransactionalOutbox,
    { provide: TransactionalOutbox, useExisting: PostgresTransactionalOutbox },
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
  ],
})
export class AppModule {}
