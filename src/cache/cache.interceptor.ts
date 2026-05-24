import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Utilities } from '@sdcorejs/utils/fns';
import { type Observable, of, tap } from 'rxjs';
import { ContextService } from '../context/context.service';
import { CacheService } from './cache.service';
import { CACHED_METADATA, type CachedOptions } from './decorators/cached.decorator';

/**
 * Interceptor that caches `@Cached`-marked method return values. Key = `<class>.<method>:<argsHash>:<tenantScopeHash>`.
 * If `ContextService` is present, the current `tenantCode/departmentCode` are folded into the key
 * so cached results stay per-tenant.
 */
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(ContextService) private readonly context?: ContextService,
  ) {}

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = execCtx.getHandler();
    const cls = execCtx.getClass();
    const opts: CachedOptions | undefined = Reflect.getMetadata(CACHED_METADATA, cls.prototype, handler.name);
    if (!opts) return next.handle();

    const args = execCtx.getArgs();
    const key = this.buildKey(cls.name, handler.name, args, opts);

    const hit = this.cache.get(key);
    if (hit !== undefined) return of(hit);

    return next.handle().pipe(tap((value) => this.cache.set(key, value, opts.ttl)));
  }

  private buildKey(className: string, methodName: string, args: unknown[], opts: CachedOptions): string {
    if (opts.keyResolver) return opts.keyResolver(methodName, args);
    const argsHash = Utilities.hash(args);
    const ctx = this.context?.store;
    const scopeHash = ctx ? Utilities.hash({ t: ctx.tenantCode, d: ctx.departmentCode }) : 'no-ctx';
    return `${className}.${methodName}:${argsHash}:${scopeHash}`;
  }
}
