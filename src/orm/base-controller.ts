import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { ObjectLiteral } from 'typeorm';
import type { Filter, PagingReq } from '@sdcorejs/utils/models';
import type { BaseService } from './base-service';
import type { Dto } from './types/dto.types';
import { ApiResponse } from './types/api-response.types';

/**
 * REST controller skeleton paired with `BaseService<T, TDto>`. Subclass with `@Controller('path')`
 * to mount the standard endpoint set:
 *
 *   POST   /search    → service.search(keyword, filters)
 *   POST   /paging    → service.paging(req)
 *   GET    /all       → service.all()
 *   GET    /:id       → service.detail(id)
 *   DELETE /:id       → service.delete(id)
 *
 * Soft-delete, restore, and paging-deleted live on `BaseService` for code paths that need them
 * (e.g. admin tools) but are not exposed by default at the controller layer.
 *
 * Add `@HasPermission(...)` per endpoint in your subclass (override + super-call) to enforce
 * permission checks per route.
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
}
