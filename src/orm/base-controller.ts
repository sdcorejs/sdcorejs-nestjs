import { Body, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { ObjectLiteral } from 'typeorm';
import type { Filter, PagingReq } from '@sdcorejs/utils/models';
import type { BaseService } from './base-service';
import type { Dto } from './types/dto.types';
import { ApiResponse } from './types/api-response.types';

/**
 * REST controller skeleton paired with `BaseService<T, TDto>`. Subclass with `@Controller('path')`
 * to mount the standard endpoint set:
 *
 *   POST   /search           → service.search(keyword, filters)
 *   POST   /paging           → service.paging(req)
 *   POST   /paging/deleted   → service.pagingDeleted(req)
 *   GET    /all              → service.all()
 *   GET    /:id              → service.detail(id)
 *   DELETE /:id              → service.delete(id)
 *   DELETE /:id/soft         → service.softDelete(id)
 *   PUT    /:id/restore      → service.restore(id)
 *
 * Add `@HasPermission(...)` per endpoint in your subclass (override + super-call) to enforce
 * permission checks per route — Phase 8 introduces the decorator.
 */
export abstract class BaseController<T extends ObjectLiteral, TDto extends Dto> {
  constructor(protected readonly baseService: BaseService<T, TDto>) {}

  @Post('search')
  async search(@Query('keyword') keyword: string, @Body() filters: Filter<T>[]) {
    return ApiResponse.ok(await this.baseService.search(keyword, filters));
  }

  @Post('paging')
  async paging(@Body() req: PagingReq<T>) {
    return ApiResponse.ok(await this.baseService.paging(req));
  }

  @Post('paging/deleted')
  async pagingDeleted(@Body() req: PagingReq<T>) {
    return ApiResponse.ok(await this.baseService.pagingDeleted(req));
  }

  @Get('all')
  async all() {
    return ApiResponse.ok(await this.baseService.all());
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ApiResponse.ok(await this.baseService.detail(id));
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.baseService.delete(id);
    return ApiResponse.noContent();
  }

  @Delete(':id/soft')
  async softDelete(@Param('id') id: string) {
    await this.baseService.softDelete(id);
    return ApiResponse.noContent();
  }

  @Put(':id/restore')
  async restore(@Param('id') id: string) {
    await this.baseService.restore(id);
    return ApiResponse.noContent();
  }
}
