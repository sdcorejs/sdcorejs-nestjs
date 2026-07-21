import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../core/orm/types/api-response.types';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { ActionHistoryService } from './action-history.service';

/**
 * Drop-in HTTP surface for reading an entity's change history
 * (`GET action-history/:table/:tableId?pageNumber=0&pageSize=100`). NOT
 * auto-registered by {@link ActionHistoryModule} — add this class to one of your own module's
 * `controllers` array so it inherits that module's route prefix (e.g. a module routed under `core`
 * exposes `GET /core/action-history/:table/:tableId`). Authentication is provided by
 * {@link AuthGuard}; resource authorization is enforced again by the service's configured
 * `authorizeRead` policy.
 */
@Controller('action-history')
@UseGuards(AuthGuard)
export class ActionHistoryController {
  constructor(private readonly history: ActionHistoryService) {}

  @Get(':table/:tableId')
  async byResource(
    @Param('table') table: string,
    @Param('tableId') tableId: string,
    @Query('pageNumber') pageNumber?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ApiResponse.ok(
      await this.history.all({
        table,
        tableId,
        pageNumber: pageNumber === undefined ? undefined : Number(pageNumber),
        pageSize: pageSize === undefined ? undefined : Number(pageSize),
      }),
    );
  }
}
