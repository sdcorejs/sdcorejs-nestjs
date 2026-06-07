import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { registerHistoryRecorder } from '../orm/history';
import { ActionHistory } from '../entities/action-history.entity';
import { ActionHistoryService } from './action-history.service';
import { ACTION_HISTORY_ACTOR_RESOLVER, type ActionHistoryActorResolver } from './types';

export interface ActionHistoryModuleOptions {
  /** Resolve the acting user per request. Default reads `ctx.userId`. */
  resolveActor?: ActionHistoryActorResolver;
  /** Register the module globally so `ActionHistoryService` injects anywhere. Default `true`. */
  global?: boolean;
  /**
   * Register `ActionHistoryService` as the `BaseRepository` history recorder so repositories created
   * with `{ logHistory: true }` auto-write action-history rows on create/update/delete. Default `true`.
   */
  registerAsHistoryRecorder?: boolean;
}

/**
 * Provides {@link ActionHistoryService} over the {@link ActionHistory} entity.
 *
 * The consumer MUST also add `ActionHistory` to their TypeORM datasource `entities` array (the
 * table is created/synchronized there). `forRoot` wires `TypeOrmModule.forFeature` + the service.
 *
 * @example
 * imports: [ActionHistoryModule.forRoot({ resolveActor: (ctx) => ({ userId: ctx.userId }) })]
 */
@Module({})
export class ActionHistoryModule {
  static forRoot(options: ActionHistoryModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [ActionHistoryService];
    if (options.resolveActor) {
      providers.push({ provide: ACTION_HISTORY_ACTOR_RESOLVER, useValue: options.resolveActor });
    }
    if (options.registerAsHistoryRecorder !== false) {
      providers.push({
        provide: 'ACTION_HISTORY_RECORDER_BINDING',
        useFactory: (service: ActionHistoryService) => {
          registerHistoryRecorder(service);
          return true;
        },
        inject: [ActionHistoryService],
      });
    }
    return {
      module: ActionHistoryModule,
      global: options.global !== false,
      imports: [TypeOrmModule.forFeature([ActionHistory])],
      providers,
      exports: [ActionHistoryService],
    };
  }
}
