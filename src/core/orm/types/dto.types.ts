/**
 * Marker interface for entity DTOs returned by `BaseService.mapDTO()`.
 *
 * `deletable` / `restorable` are used by `BaseService.delete()` / `.softDelete()` / `.restore()`
 * to filter out rows the caller is not allowed to act on. Default both to `true` in your `mapDTO`
 * implementation unless your domain has explicit permission rules.
 */
export interface Dto {
  id: string;
  deletable?: boolean;
  restorable?: boolean;
}
