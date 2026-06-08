import { BadRequestException, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiResponse, apiError } from '../../core/orm/types/api-response.types';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { UploadedFileService } from './services/uploaded-file.service';

/**
 * Drop-in HTTP surface for uploads/downloads so a consumer doesn't have to write its own file
 * controller. NOT auto-registered by {@link UploadedFileModule} — add this class to one of your
 * own module's `controllers` array so it inherits that module's route prefix (e.g. a module routed
 * under `core` exposes `POST /core/file` + `GET /core/file/:id/download`), then it just works.
 *
 * Secured by the lib {@link AuthGuard} (JWT via the consumer's passport `jwt` strategy). Depends on
 * the globally-provided {@link UploadedFileService} (wire `uploadedFile` in `SdCoreModule.forRoot`).
 * Requires `@nestjs/platform-express` (`FileInterceptor`) in the host.
 */
@Controller('file')
@UseGuards(AuthGuard)
export class UploadedFileController {
  constructor(private readonly service: UploadedFileService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
    @Query('module') module?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('type') type?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException(apiError('core.file.empty', 'No file provided'));
    const uploaded = await this.service.upload(file.buffer, file.originalname, { module, entity, entityId, type });
    return ApiResponse.ok(uploaded);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const { stream, fileName } = await this.service.download(id);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURI(fileName)}"`);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
