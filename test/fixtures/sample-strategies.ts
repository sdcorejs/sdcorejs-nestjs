import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { ContextService } from '../../src/core/context/context.service';
import type { RequestContext } from '../../src/core/context/types';
import type { ITenancyStrategy } from '../../src/core/tenancy/strategy.interface';
import type { IAuditStrategy } from '../../src/core/audit/strategy.interface';
import type { IPermissionStrategy } from '../../src/auth/permission/strategy.interface';

/** Sample tenancy strategy reading `tenant` from context; bypass via `ctx.custom.isSystemAdmin`.
 *  Maps the framework-level `tenant` value to the entity column name `tenantCode`. */
@Injectable()
export class SampleTenancyStrategy implements ITenancyStrategy {
  constructor(@Optional() @Inject(ContextService) private readonly ctx?: ContextService) {}
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return { tenantCode: ctx.tenant ?? this.ctx?.tenant };
  }
  shouldBypass(ctx: RequestContext): boolean {
    return ctx.custom?.isSystemAdmin === true;
  }
}

/** Sample audit strategy fills `createdBy/modifier` from ContextService. */
@Injectable()
export class SampleAuditStrategy implements IAuditStrategy {
  constructor(@Optional() @Inject(ContextService) private readonly ctx?: ContextService) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.ctx?.userId;
    if (!userId) return;
    if (entity.createdBy == null) entity.createdBy = userId;
    if (entity.modifiedBy == null) entity.modifiedBy = userId;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void {
    const userId = ctx.userId ?? this.ctx?.userId;
    if (!userId) return;
    entity.modifiedBy = userId;
  }
  onSoftDelete(): void {
    /* no-op */
  }
}

/** Sample permission strategy returns hardcoded codes from context. */
@Injectable()
export class SamplePermissionStrategy implements IPermissionStrategy {
  async load(ctx: RequestContext): Promise<string[]> {
    return ctx.permissions ?? [];
  }
}
