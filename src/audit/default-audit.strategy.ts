import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { ContextService } from '../context/context.service';
import type { RequestContext } from '../context/context.types';
import type { UserSnapshot } from '../orm/types/user-snapshot.types';
import type { IAuditStrategy } from './strategy.interface';

/**
 * Default audit strategy reading current user from `ContextService`. On create, fills
 * `createdBy/modifiedBy` + jsonb `creator/modifier`. On update, fills `modifiedBy/modifier`.
 * Soft-delete is a no-op — TypeORM's `@DeleteDateColumn` already records the timestamp.
 *
 * If `ctx.userId` is undefined, the strategy skips silently rather than throwing — anonymous
 * inserts (system-internal jobs, seed scripts) should not fail.
 */
@Injectable()
export class DefaultAuditStrategy implements IAuditStrategy {
  constructor(@Optional() @Inject(ContextService) private readonly context?: ContextService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.context?.userId;
    if (!userId) return;
    const snapshot = this.snapshot(ctx, userId);
    if (entity.createdBy == null) entity.createdBy = userId;
    if (entity.creator == null && snapshot) entity.creator = snapshot;
    if (entity.modifiedBy == null) entity.modifiedBy = userId;
    if (entity.modifier == null && snapshot) entity.modifier = snapshot;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.context?.userId;
    if (!userId) return;
    const snapshot = this.snapshot(ctx, userId);
    entity.modifiedBy = userId;
    if (snapshot) entity.modifier = snapshot;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSoftDelete(_entity: DeepPartial<any>, _ctx: RequestContext): void {
    /* timestamp auto-recorded by TypeORM @DeleteDateColumn */
  }

  private snapshot(ctx: RequestContext, userId: string): UserSnapshot | null {
    const username = ctx.username ?? this.context?.username;
    const fullName = ctx.fullName ?? this.context?.fullName;
    if (!username || !fullName) return null;
    return { id: userId, username, fullName };
  }
}
