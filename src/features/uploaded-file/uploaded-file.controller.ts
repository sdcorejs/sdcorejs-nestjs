import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ApiResponse, apiError } from '../../core/orm/types/api-response.types';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { UploadedFileService } from './services/uploaded-file.service';
import { ABSOLUTE_MAX_UPLOAD_BYTES } from './config';
import { contentDisposition } from './upload-security';
import type { InitiateUploadedFileInput, UploadedFileHttpResult, UploadedFileResult } from './types';

interface BufferedMultipartFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

/**
 * Drop-in HTTP surface for uploads/downloads so a consumer doesn't have to write its own file
 * controller. NOT auto-registered by {@link UploadedFileModule} — add this class to one of your
 * own module's `controllers` array so it inherits that module's route prefix (e.g. a module routed
 * under `core` exposes the provider-neutral initiate/complete/detail/delete routes plus the legacy
 * multipart and streaming-download routes).
 *
 * Secured by the lib {@link AuthGuard} (JWT via the consumer's passport `jwt` strategy). Depends on
 * the globally-provided {@link UploadedFileService} (wire `uploadedFile` in `SdCoreModule.forRoot`).
 * Requires `@nestjs/platform-express` (`FileInterceptor`) in the host.
 */
@Controller('uploaded-file')
@UseGuards(AuthGuard)
export class UploadedFileController {
  constructor(private readonly service: UploadedFileService) {}

  private safeResult(result: UploadedFileResult): UploadedFileHttpResult {
    const { key: _key, cdn: _cdn, ...safe } = result;
    return safe;
  }

  private initiateInput(value: unknown): InitiateUploadedFileInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(apiError('core.file.invalid-upload', 'Invalid upload metadata'));
    }
    const body = value as Record<string, unknown>;
    const allowed = new Set(['originalName', 'contentType', 'size', 'checksum']);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      throw new BadRequestException(apiError('core.file.invalid-upload', 'Invalid upload metadata'));
    }
    return {
      originalName: body.originalName as string,
      contentType: body.contentType as string,
      size: body.size as number,
      ...(body.checksum !== undefined ? { checksum: body.checksum as string } : {}),
    };
  }

  private boundedRawBody(bytes: Buffer): Buffer {
    if (bytes.byteLength > ABSOLUTE_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(apiError('core.file.too-large', 'Uploaded file is too large'));
    }
    return bytes;
  }

  private async rawUploadBody(request: Request): Promise<Buffer> {
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > ABSOLUTE_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(apiError('core.file.too-large', 'Uploaded file is too large'));
    }
    if (Buffer.isBuffer(request.body)) return this.boundedRawBody(request.body);
    if (typeof request.body === 'string') return this.boundedRawBody(Buffer.from(request.body));
    if (request.body !== undefined && request.body !== null && Object.keys(request.body as object).length > 0) {
      throw new BadRequestException(apiError('core.file.invalid-upload', 'Invalid raw upload body'));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > ABSOLUTE_MAX_UPLOAD_BYTES) {
        throw new PayloadTooLargeException(apiError('core.file.too-large', 'Uploaded file is too large'));
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  }

  @Post('initiate')
  async initiate(@Body() body: unknown) {
    return ApiResponse.ok(await this.service.initiateUpload(this.initiateInput(body)));
  }

  @Post('temporary/initiate')
  async initiateTemporary(@Body() body: unknown) {
    return ApiResponse.ok(await this.service.initiateTemporaryUpload(this.initiateInput(body)));
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    return ApiResponse.ok(this.safeResult(await this.service.completeUpload(id)));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ApiResponse.ok(this.safeResult(await this.service.find(id)));
  }

  @Delete(':id')
  @HttpCode(200)
  async delete(@Param('id') id: string) {
    await this.service.deleteById(id);
    return ApiResponse.noContent();
  }

  @Put(':id/content')
  @HttpCode(200)
  async putContent(@Param('id') id: string, @Req() request: Request) {
    const result = await this.service.putUploadContent(id, await this.rawUploadBody(request));
    return ApiResponse.ok(this.safeResult(result));
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: ABSOLUTE_MAX_UPLOAD_BYTES,
        files: 1,
        fields: 4,
        parts: 5,
        fieldNameSize: 128,
        fieldSize: 4096,
        headerPairs: 100,
      },
    }),
  )
  async upload(
    @UploadedFile() file: BufferedMultipartFile | undefined,
    @Query('module') module?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('type') type?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException(apiError('core.file.empty', 'No file provided'));
    const uploaded = await this.service.upload(file.buffer, file.originalname, { module, entity, entityId, type }, undefined, {
      contentType: file.mimetype,
    });
    return ApiResponse.ok(this.safeResult(await this.service.find(uploaded.id)));
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const { stream, fileName } = await this.service.download(id);
    const { ContentType } = this.service.getContent(fileName);
    response.setHeader('Content-Type', ContentType ?? 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', contentDisposition(fileName));
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
