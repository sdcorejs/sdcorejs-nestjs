import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { ContextService } from '../context/context.service';
import { isAuditEnabled } from '../orm/mixins/with-audit';
import type { ClassRef } from '../orm/types/class-ref.types';
import type { IAuditStrategy } from './strategy.interface';
import { AUDIT_STRATEGY } from './tokens';

/**
 * TypeORM entity subscriber that delegates audit-field filling to `IAuditStrategy`.
 *
 * Wire manually after instantiation:
 *
 * ```ts
 * const subscriber = app.get(AuditSubscriber);
 * dataSource.subscribers.push(subscriber);
 * ```
 *
 * Fires only for entities produced by the `WithAudit` mixin (detected via metadata).
 * Idempotent — if `entity.createdBy` is already populated (e.g. by `BaseRepository.create`
 * which calls the strategy directly), the subscriber skips to avoid double-fill.
 */
@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(
    @Inject(AUDIT_STRATEGY) private readonly strategy: IAuditStrategy,
    @Optional() @Inject(ContextService) private readonly contextService?: ContextService,
  ) {}

  beforeInsert(event: InsertEvent<unknown>): void {
    const entity = event.entity as Record<string, unknown> | undefined;
    if (!entity || !isAuditEnabled(entity.constructor as ClassRef)) return;
    if (entity.createdBy != null) return; // already filled by repository hook
    this.strategy.onCreate(entity, this.contextService?.store ?? {});
  }

  beforeUpdate(event: UpdateEvent<unknown>): void {
    const entity = event.entity as Record<string, unknown> | undefined;
    if (!entity || !isAuditEnabled(entity.constructor as ClassRef)) return;
    this.strategy.onUpdate(entity, this.contextService?.store ?? {});
  }

  beforeSoftRemove(event: SoftRemoveEvent<unknown>): void {
    const entity = event.entity as Record<string, unknown> | undefined;
    if (!entity || !isAuditEnabled(entity.constructor as ClassRef)) return;
    this.strategy.onSoftDelete(entity, this.contextService?.store ?? {});
  }
}
