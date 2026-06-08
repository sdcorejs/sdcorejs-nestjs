/**
 * Minimal shape for the user object snapshotted into audit jsonb columns
 * (`creator`, `modifier`) by `WithAudit` mixin. Consumer apps may widen via generics
 * if their user object carries more fields.
 */
export interface UserSnapshot {
  id: string;
  username: string;
  fullName: string;
}
