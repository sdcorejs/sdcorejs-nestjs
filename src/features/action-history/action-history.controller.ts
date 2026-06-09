import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiResponse } from '../../core/orm/types/api-response.types';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { ActionHistoryService } from './action-history.service';

/**
 * Drop-in HTTP surface for reading an entity's change history (`GET action-history/:tableId`). NOT
 * auto-registered by {@link ActionHistoryModule} — add this class to one of your own module's
 * `controllers` array so it inherits that module's route prefix (e.g. a module routed under `core`
 * exposes `GET /core/action-history/:tableId`). Secured by the lib {@link AuthGuard} (JWT via the
 * consumer's passport `jwt` strategy); depends on the globally-provided {@link ActionHistoryService}.
 */
@Controller('action-history')
@UseGuards(AuthGuard)
export class ActionHistoryController {
  constructor(private readonly history: ActionHistoryService) {}

  @Get(':tableId')
  async byTableId(@Param('tableId') tableId: string) {
    return ApiResponse.ok(await this.history.all(tableId));
  }
}
