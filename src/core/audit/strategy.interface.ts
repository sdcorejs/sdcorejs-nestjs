import type { DeepPartial } from 'typeorm';
import type { RequestContext } from '../context/types';

/**
 * Contract for filling audit fields. `BaseRepository.create` calls `onCreate` on the entity
 * BEFORE `repository.save`; `BaseRepository.update` calls `onUpdate`. Soft-delete callbacks
 * fire from `AuditSubscriber` when manually wired on the DataSource.
 */
export interface IAuditStrategy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSoftDelete(entity: DeepPartial<any>, ctx: RequestContext): void;
}
