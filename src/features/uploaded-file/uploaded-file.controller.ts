import { BadRequestException, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiResponse, apiError } from '../../core/orm/types/api-response.types';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { UploadedFileService } from './services/uploaded-file.service';
import { ABSOLUTE_MAX_UPLOAD_BYTES } from './config';
import { contentDisposition } from './upload-security';

interface BufferedMultipartFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

/**
 * Drop-in HTTP surface for uploads/downloads so a consumer doesn't have to write its own file
 * controller. NOT auto-registered by {@link UploadedFileModule} — add this class to one of your
 * own module's `controllers` array so it inherits that module's route prefix (e.g. a module routed
 * under `core` exposes `POST /core/uploaded-file` + `GET /core/uploaded-file/:id/download`).
 *
 * Secured by the lib {@link AuthGuard} (JWT via the consumer's passport `jwt` strategy). Depends on
 * the globally-provided {@link UploadedFileService} (wire `uploadedFile` in `SdCoreModule.forRoot`).
 * Requires `@nestjs/platform-express` (`FileInterceptor`) in the host.
 */
@Controller('uploaded-file')
@UseGuards(AuthGuard)
export class UploadedFileController {
  constructor(private readonly service: UploadedFileService) {}

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
    return ApiResponse.ok(uploaded);
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
