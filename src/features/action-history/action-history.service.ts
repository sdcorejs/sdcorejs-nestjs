import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { QueryRunner, Repository } from 'typeorm';
import { ContextService } from '../../context/context.service';
import type { HistoryEntry, IHistoryRecorder } from '../../orm/history';
import { ActionHistory } from './action-history.entity';
import {
  ACTION_HISTORY_ACTOR_RESOLVER,
  type ActionHistoryActorResolver,
  type ActionHistoryDTO,
  type ActionHistorySaveReq,
  ActionHistoryType,
} from './types';

/**
 * Records and queries manual action-history rows. The acting user is resolved per request from
 * {@link ContextService} (default: `ctx.userId`) or a consumer-supplied {@link ActionHistoryActorResolver}.
 */
@Injectable()
export class ActionHistoryService implements IHistoryRecorder {
  constructor(
    @InjectRepository(ActionHistory) private readonly repository: Repository<ActionHistory>,
    @Optional() private readonly context?: ContextService,
    @Optional() @Inject(ACTION_HISTORY_ACTOR_RESOLVER) private readonly resolveActor?: ActionHistoryActorResolver,
  ) {}

  async create<T = unknown>(req: ActionHistorySaveReq<T>, queryRunner?: QueryRunner): Promise<void> {
    const actor = this.context ? (this.resolveActor?.(this.context) ?? { userId: this.context.userId }) : {};
    const entity = this.repository.create({
      ...req,
      userId: actor.userId,
      username: actor.username,
      fullName: actor.fullName,
    } as ActionHistory);
    if (queryRunner) {
      await queryRunner.manager.save(entity);
    } else {
      await this.repository.save(entity);
    }
  }

  /** {@link IHistoryRecorder} entry point — called by `BaseRepository` CUD when `logHistory` is on. */
  async record(entry: HistoryEntry): Promise<void> {
    await this.create(
      {
        table: entry.table,
        tableId: entry.tableId,
        type: entry.type as ActionHistoryType,
        fromData: entry.fromData,
        toData: entry.toData,
      },
      entry.queryRunner,
    );
  }

  async all(tableId: string): Promise<ActionHistoryDTO[]> {
    const entities = await this.repository.find({ where: { tableId }, order: { createdAt: 'DESC' } });
    return entities.map((e) => this.mapDTO(e));
  }

  private mapDTO(entity: ActionHistory): ActionHistoryDTO {
    const { id, table, tableId, userId, username, fullName, type, fromData, toData, note, createdAt } = entity;
    return {
      id,
      table,
      tableId,
      userId,
      username,
      fullName,
      type,
      fromData,
      toData,
      note,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    };
  }
}
