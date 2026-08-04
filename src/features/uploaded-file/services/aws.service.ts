import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { NormalizedUploadedFileConfig } from '../config';
import type {
  UploadedFileStorageDownloadUrlRequest,
  UploadedFileStorageDriver,
  UploadedFileStorageObjectMetadata,
  UploadedFileStoragePromoteRequest,
  UploadedFileStorageSource,
  UploadedFileStorageUploadTarget,
  UploadedFileStorageUploadUrlRequest,
  UploadedFileStorageWriteOptions,
} from '../storage-driver';
import { UPLOADED_FILE_CONFIG } from '../types';

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

type S3CommandConstructor = new (input: Record<string, unknown>) => unknown;

interface S3SdkModule {
  S3Client: new (config: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: S3CommandConstructor;
  GetObjectCommand: S3CommandConstructor;
  HeadObjectCommand: S3CommandConstructor;
  CopyObjectCommand: S3CommandConstructor;
  DeleteObjectsCommand: S3CommandConstructor;
}

interface S3PresignerModule {
  getSignedUrl(client: S3ClientLike, command: unknown, options: { expiresIn: number }): Promise<string>;
}

interface S3Runtime {
  client: S3ClientLike;
  PutObjectCommand: S3CommandConstructor;
  GetObjectCommand: S3CommandConstructor;
  HeadObjectCommand: S3CommandConstructor;
  CopyObjectCommand: S3CommandConstructor;
  DeleteObjectsCommand: S3CommandConstructor;
  getSignedUrl: S3PresignerModule['getSignedUrl'];
}

class MissingS3DependencyError extends Error {}

const MISSING_S3_DEPENDENCY_MESSAGE =
  "@sdcorejs/nestjs uploaded-file S3 driver requires optional dependencies '@aws-sdk/client-s3' and '@aws-sdk/s3-request-presigner'";

/** Internal S3 byte driver. Keys are generated and authorized exclusively by UploadedFileService. */
@Injectable()
export class AwsUploadedFileStorage implements UploadedFileStorageDriver {
  readonly kind = 's3' as const;
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
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: config.forcePathStyle === true } : {}),
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

  async createUploadUrl(input: UploadedFileStorageUploadUrlRequest): Promise<UploadedFileStorageUploadTarget> {
    try {
      const { client, PutObjectCommand, getSignedUrl } = await this.runtime();
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentLength: input.size,
        ContentType: input.contentType,
        Metadata: { ...input.metadata },
        ...(input.checksum ? { ChecksumSHA256: input.checksum } : {}),
      });
      const url = await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
      const headers: Record<string, string> = {
        'content-length': String(input.size),
        'content-type': input.contentType,
      };
      for (const [key, value] of Object.entries(input.metadata)) headers[`x-amz-meta-${key.toLowerCase()}`] = value;
      if (input.checksum) headers['x-amz-checksum-sha256'] = input.checksum;
      return { method: 'PUT', url, headers };
    } catch (error) {
      this.rethrowDependencyError(error);
      throw new Error('S3 upload URL creation failed');
    }
  }

  async headObject(key: string): Promise<UploadedFileStorageObjectMetadata | null> {
    try {
      const { client, HeadObjectCommand } = await this.runtime();
      const result = (await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' }))) as {
        ContentLength?: number;
        ContentType?: string;
        ETag?: string;
        ChecksumSHA256?: string;
        Metadata?: Record<string, string>;
      };
      return {
        size: Number(result.ContentLength ?? 0),
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
        checksum: result.ChecksumSHA256 ?? null,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      this.rethrowDependencyError(error);
      if (this.isObjectNotFound(error)) return null;
      throw new Error('S3 object head failed');
    }
  }

  async promoteObject(input: UploadedFileStoragePromoteRequest): Promise<void> {
    try {
      const { client, CopyObjectCommand } = await this.runtime();
      await client.send(
        new CopyObjectCommand({
          ...(input.visibility === 'public' && input.publicAccessMode === 'object-acl' ? { ACL: 'public-read' } : {}),
          Bucket: this.bucket,
          CopySource: this.copySource(input.sourceKey),
          ...(input.sourceEtag ? { CopySourceIfMatch: input.sourceEtag } : {}),
          Key: input.destinationKey,
        }),
      );
    } catch (error) {
      this.rethrowDependencyError(error);
      throw new Error('S3 object promotion failed');
    }
  }

  async putObject(key: string, source: UploadedFileStorageSource, options: UploadedFileStorageWriteOptions): Promise<void> {
    try {
      const { client, PutObjectCommand } = await this.runtime();
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: source,
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

  async write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void> {
    await this.putObject(key, buffer, options);
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

  async deleteObject(key: string): Promise<void> {
    await this.delete([key]);
  }

  async createDownloadUrl(input: UploadedFileStorageDownloadUrlRequest): Promise<string> {
    try {
      const { client, GetObjectCommand, getSignedUrl } = await this.runtime();
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ...(input.contentDisposition ? { ResponseContentDisposition: input.contentDisposition } : {}),
        ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
      });
      return await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
    } catch (error) {
      this.rethrowDependencyError(error);
      throw new Error('S3 download URL creation failed');
    }
  }

  publicUrl(key: string): string {
    return this.resolvePublicUrl(key);
  }

  resolvePublicUrl(key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (this.config.cdnBaseUrl) return `${this.config.cdnBaseUrl.replace(/\/+$/, '')}/${encodedKey}`;
    if (this.config.endpoint) {
      const endpoint = new URL(this.config.endpoint);
      if (this.config.forcePathStyle) {
        return `${this.config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(this.bucket)}/${encodedKey}`;
      }
      const port = endpoint.port ? `:${endpoint.port}` : '';
      return `${endpoint.protocol}//${encodeURIComponent(this.bucket)}.${endpoint.hostname}${port}/${encodedKey}`;
    }
    const region = this.config.region && this.config.region !== 'us-east-1' ? `.${this.config.region}` : '';
    return `https://${encodeURIComponent(this.bucket)}.s3${region}.amazonaws.com/${encodedKey}`;
  }

  private runtime(): Promise<S3Runtime> {
    this.runtimePromise ??= this.loadRuntime();
    return this.runtimePromise;
  }

  private async loadRuntime(): Promise<S3Runtime> {
    let sdk: S3SdkModule;
    let presigner: S3PresignerModule;
    try {
      [sdk, presigner] = (await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')])) as unknown as [
        S3SdkModule,
        S3PresignerModule,
      ];
    } catch (error) {
      if (this.isMissingS3Package(error)) throw new MissingS3DependencyError(MISSING_S3_DEPENDENCY_MESSAGE);
      throw error;
    }

    if (
      typeof sdk.S3Client !== 'function' ||
      typeof sdk.PutObjectCommand !== 'function' ||
      typeof sdk.GetObjectCommand !== 'function' ||
      typeof sdk.HeadObjectCommand !== 'function' ||
      typeof sdk.CopyObjectCommand !== 'function' ||
      typeof sdk.DeleteObjectsCommand !== 'function' ||
      typeof presigner.getSignedUrl !== 'function'
    ) {
      throw new Error('Invalid S3 SDK module');
    }
    return {
      client: new sdk.S3Client(this.clientConfig),
      PutObjectCommand: sdk.PutObjectCommand,
      GetObjectCommand: sdk.GetObjectCommand,
      HeadObjectCommand: sdk.HeadObjectCommand,
      CopyObjectCommand: sdk.CopyObjectCommand,
      DeleteObjectsCommand: sdk.DeleteObjectsCommand,
      getSignedUrl: presigner.getSignedUrl,
    };
  }

  private copySource(key: string): string {
    return [this.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
  }

  private isObjectNotFound(error: unknown): boolean {
    const value = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } } | undefined;
    return (
      value?.name === 'NotFound' || value?.name === 'NoSuchKey' || value?.Code === 'NoSuchKey' || value?.$metadata?.httpStatusCode === 404
    );
  }

  private isMissingS3Package(error: unknown): boolean {
    if (!(error instanceof Error) || !('code' in error)) return false;
    const code = (error as Error & { code?: unknown }).code;
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') return false;
    const firstLine = error.message.split(/\r?\n/, 1)[0] ?? '';
    return /Cannot find (?:module|package) ['"]@aws-sdk\/(?:client-s3|s3-request-presigner)['"]/.test(firstLine);
  }

  private rethrowDependencyError(error: unknown): void {
    if (error instanceof MissingS3DependencyError) throw error;
  }
}
