import { Inject, Injectable, Optional } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import { ContextService } from '../../src/context/context.service';
import type { RequestContext } from '../../src/context/context.types';
import type { ITenancyStrategy } from '../../src/tenancy/strategy.interface';
import type { IAuditStrategy } from '../../src/audit/strategy.interface';
import type { IPermissionStrategy } from '../../src/permission/strategy.interface';

/** Sample tenancy strategy reading `tenantCode` + `departmentCode` from context. */
@Injectable()
export class SampleTenancyStrategy implements ITenancyStrategy {
  constructor(@Optional() @Inject(ContextService) private readonly ctx?: ContextService) {}
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return { tenantCode: ctx.tenantCode ?? this.ctx?.tenantCode };
  }
  shouldBypass(ctx: RequestContext): boolean {
    return ctx.isSystemAdmin === true;
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
