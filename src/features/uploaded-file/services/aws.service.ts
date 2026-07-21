import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { NormalizedUploadedFileConfig } from '../config';
import type { UploadedFileStorageDriver, UploadedFileStorageWriteOptions } from '../storage-driver';
import { UPLOADED_FILE_CONFIG } from '../types';

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

type S3CommandConstructor = new (input: Record<string, unknown>) => unknown;

interface S3SdkModule {
  S3Client: new (config: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: S3CommandConstructor;
  GetObjectCommand: S3CommandConstructor;
  DeleteObjectsCommand: S3CommandConstructor;
}

interface S3Runtime {
  client: S3ClientLike;
  PutObjectCommand: S3CommandConstructor;
  GetObjectCommand: S3CommandConstructor;
  DeleteObjectsCommand: S3CommandConstructor;
}

class MissingS3DependencyError extends Error {}

const MISSING_S3_DEPENDENCY_MESSAGE = "@sdcorejs/nestjs uploaded-file S3 driver requires optional dependency '@aws-sdk/client-s3'";

/** Internal S3 byte driver. Keys are generated and authorized exclusively by UploadedFileService. */
@Injectable()
export class AwsUploadedFileStorage implements UploadedFileStorageDriver {
  private readonly bucket: string;
  private readonly clientConfig: Record<string, unknown>;
  private runtimePromise?: Promise<S3Runtime>;

  constructor(@Inject(UPLOADED_FILE_CONFIG) private readonly config: NormalizedUploadedFileConfig) {
    this.bucket = config.bucket ?? '';
    const hasAccessId = config.accessId !== undefined;
    const hasAccessKey = config.accessKey !== undefined;
    if (hasAccessId !== hasAccessKey || (hasAccessId && (!config.accessId?.trim().length || !config.accessKey?.trim().length))) {
      throw new Error('Uploaded-file S3 credentials require both non-empty accessId and accessKey');
    }

    this.clientConfig = {
      ...(config.region?.trim() ? { region: config.region.trim() } : {}),
      ...(hasAccessId
        ? {
            credentials: {
              accessKeyId: config.accessId,
              secretAccessKey: config.accessKey,
            },
          }
        : {}),
    };
  }

  async write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void> {
    try {
      const { client, PutObjectCommand } = await this.runtime();
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: options.contentType,
          ContentDisposition: options.contentDisposition,
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      this.rethrowDependencyError(error);
      throw new Error('S3 object write failed');
    }
  }

  async download(key: string): Promise<Readable> {
    try {
      const { client, GetObjectCommand } = await this.runtime();
      const result = (await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))) as { Body?: unknown };
      if (!(result.Body instanceof Readable)) throw new Error('Unexpected S3 response body');
      return result.Body;
    } catch (error) {
      this.rethrowDependencyError(error);
      throw new Error('S3 object download failed');
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    const unique = Array.from(new Set(keys));
    for (let offset = 0; offset < unique.length; offset += 1000) {
      const chunk = unique.slice(offset, offset + 1000);
      try {
        const { client, DeleteObjectsCommand } = await this.runtime();
        const result = (await client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })) },
          }),
        )) as { Errors?: readonly unknown[] };
        if (result.Errors?.length) throw new Error('S3 reported per-object deletion errors');
      } catch (error) {
        this.rethrowDependencyError(error);
        throw new Error('S3 object deletion failed');
      }
    }
  }

  publicUrl(key: string): string {
    const base = this.config.cdnBaseUrl ? `${this.config.cdnBaseUrl.replace(/\/+$/, '')}/` : '';
    return `${base}${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private runtime(): Promise<S3Runtime> {
    this.runtimePromise ??= this.loadRuntime();
    return this.runtimePromise;
  }

  private async loadRuntime(): Promise<S3Runtime> {
    let sdk: S3SdkModule;
    try {
      sdk = (await import('@aws-sdk/client-s3')) as unknown as S3SdkModule;
    } catch (error) {
      if (this.isMissingS3Package(error)) throw new MissingS3DependencyError(MISSING_S3_DEPENDENCY_MESSAGE);
      throw error;
    }

    if (
      typeof sdk.S3Client !== 'function' ||
      typeof sdk.PutObjectCommand !== 'function' ||
      typeof sdk.GetObjectCommand !== 'function' ||
      typeof sdk.DeleteObjectsCommand !== 'function'
    ) {
      throw new Error('Invalid S3 SDK module');
    }
    return {
      client: new sdk.S3Client(this.clientConfig),
      PutObjectCommand: sdk.PutObjectCommand,
      GetObjectCommand: sdk.GetObjectCommand,
      DeleteObjectsCommand: sdk.DeleteObjectsCommand,
    };
  }

  private isMissingS3Package(error: unknown): boolean {
    if (!(error instanceof Error) || !('code' in error)) return false;
    const code = (error as Error & { code?: unknown }).code;
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') return false;
    const firstLine = error.message.split(/\r?\n/, 1)[0] ?? '';
    return /Cannot find (?:module|package) ['"]@aws-sdk\/client-s3['"]/.test(firstLine);
  }

  private rethrowDependencyError(error: unknown): void {
    if (error instanceof MissingS3DependencyError) throw error;
  }
}
