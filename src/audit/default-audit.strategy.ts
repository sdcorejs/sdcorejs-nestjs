import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { ContextService } from '../context/context.service';
import type { RequestContext } from '../context/context.types';
import type { IAuditStrategy } from './strategy.interface';

/**
 * Default audit strategy filling `createdBy` + `modifiedBy` from `ctx.userId`.
 *
 * Lib intentionally does NOT populate `creator` / `modifier` jsonb snapshots — those
 * carry domain-shaped user info (e.g. username, fullName, role). Subclass to add snapshot
 * filling that reads from `ctx.custom`, `ctx.user`, or your own auth provider.
 *
 * If `ctx.userId` is undefined, this strategy skips silently — anonymous inserts (system
 * jobs, seed scripts) should not fail.
 */
@Injectable()
export class DefaultAuditStrategy implements IAuditStrategy {
  constructor(@Optional() @Inject(ContextService) private readonly context?: ContextService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.context?.userId;
    if (!userId) return;
    if (entity.createdBy == null) entity.createdBy = userId;
    if (entity.modifiedBy == null) entity.modifiedBy = userId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.context?.userId;
    if (!userId) return;
    entity.modifiedBy = userId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSoftDelete(_entity: DeepPartial<any>, _ctx: RequestContext): void {
    /* timestamp auto-recorded by TypeORM @DeleteDateColumn */
  }
}
