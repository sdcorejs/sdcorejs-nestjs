import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive PostgreSQL migration for the direct-upload/public-private/temporary lifecycle.
 *
 * Existing rows are backfilled as private, ready, permanent files so this migration never makes a
 * previously protected object public or starts expiring legacy data. A deployment that intentionally
 * used legacy `publicFiles: true` can opt selected rows into public visibility after verifying its
 * bucket/CDN policy; see the matching migration guide.
 */
export class UploadedFileDirectLifecycle1785744000000 implements MigrationInterface {
  readonly name = 'UploadedFileDirectLifecycle1785744000000';
  readonly transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "sizeBytes" integer',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "contentType" varchar(255)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "pendingKey" varchar(1024)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "visibility" varchar(16)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "status" varchar(16)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "isTemporary" boolean',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "uploadExpiredAt" timestamptz',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "expiredAt" timestamptz',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "completedAt" timestamptz',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "disposition" varchar(16)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "checksum" varchar(128)',
      'ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "etag" varchar(255)',
      'UPDATE "uploaded_file" SET "visibility" = \'private\' WHERE "visibility" IS NULL',
      'UPDATE "uploaded_file" SET "status" = \'ready\' WHERE "status" IS NULL',
      'UPDATE "uploaded_file" SET "isTemporary" = false WHERE "isTemporary" IS NULL',
      'UPDATE "uploaded_file" SET "disposition" = \'attachment\' WHERE "disposition" IS NULL',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "visibility" SET DEFAULT \'private\'',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "visibility" SET NOT NULL',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "status" SET DEFAULT \'ready\'',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "status" SET NOT NULL',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "isTemporary" SET DEFAULT false',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "isTemporary" SET NOT NULL',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "disposition" SET DEFAULT \'attachment\'',
      'ALTER TABLE "uploaded_file" ALTER COLUMN "disposition" SET NOT NULL',
      'CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_pending_cleanup" ON "uploaded_file" ("status", "uploadExpiredAt")',
      'CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_temporary_cleanup" ON "uploaded_file" ("isTemporary", "status", "expiredAt")',
      'CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_tenant_owner_status" ON "uploaded_file" ("tenantCode", "departmentCode", "userId", "status")',
    ];
    for (const statement of statements) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      'DROP INDEX IF EXISTS "IDX_uploaded_file_tenant_owner_status"',
      'DROP INDEX IF EXISTS "IDX_uploaded_file_temporary_cleanup"',
      'DROP INDEX IF EXISTS "IDX_uploaded_file_pending_cleanup"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "etag"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "checksum"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "disposition"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "completedAt"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "expiredAt"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "uploadExpiredAt"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "isTemporary"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "status"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "visibility"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "pendingKey"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "contentType"',
      'ALTER TABLE "uploaded_file" DROP COLUMN IF EXISTS "sizeBytes"',
    ];
    for (const statement of statements) await queryRunner.query(statement);
  }
}
