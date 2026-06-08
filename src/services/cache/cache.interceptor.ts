import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor, Optional } from '@nestjs/common';
import { Utilities } from '@sdcorejs/utils/fns';
import { from, type Observable, of, switchMap, tap } from 'rxjs';
import { ContextService } from '../../core/context/context.service';
import { CacheService } from './cache.service';
import { CACHED_METADATA, type CachedOptions } from './decorators/cached.decorator';

/**
 * Interceptor that caches `@Cached`-marked method return values. Key = `<class>.<method>:<argsHash>:<tenantScopeHash>`.
 * If `ContextService` is present, the current `tenant` is folded into the key so cached
 * results stay per-tenant. Cache backend (memory or redis) is async so the interceptor
 * threads the lookup through the observable pipeline.
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

    return from(this.cache.get(key)).pipe(
      switchMap((hit) => {
        if (hit !== undefined) return of(hit);
        return next.handle().pipe(
          tap((value) => {
            void this.cache.set(key, value, opts.ttl);
          }),
        );
      }),
    );
  }

  private buildKey(className: string, methodName: string, args: unknown[], opts: CachedOptions): string {
    if (opts.keyResolver) return opts.keyResolver(methodName, args);
    const argsHash = Utilities.hash(args);
    const ctx = this.context?.store;
    const scopeHash = ctx ? Utilities.hash({ t: ctx.tenant }) : 'no-ctx';
    return `${className}.${methodName}:${argsHash}:${scopeHash}`;
  }
}
