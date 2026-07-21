/** Base error for fail-closed tenancy enforcement failures. */
export class TenancyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when a scoped entity is accessed without any configured tenancy strategy. */
export class MissingTenancyContextError extends TenancyError {
  constructor(targetName?: string) {
    super(
      'TENANCY_CONTEXT_MISSING',
      targetName ? `Tenancy context is required for scoped entity ${targetName}` : 'Tenancy context is required',
    );
  }
}

/** Thrown when one or more required scope dimensions have no current value. */
export class MissingTenancyScopeError extends TenancyError {
  constructor(public readonly scopeColumns: readonly string[]) {
    super('TENANCY_SCOPE_MISSING', `Required tenancy scope is missing: ${scopeColumns.join(', ')}`);
  }
}

/** Thrown when a scope value cannot safely be converted into a query or entity value. */
export class InvalidTenancyScopeError extends TenancyError {
  constructor(column: string, reason: string) {
    super('TENANCY_SCOPE_INVALID', `Invalid tenancy scope for ${column}: ${reason}`);
  }
}

/** Thrown when ordinary update input attempts to move a row between scopes. */
export class TenancyScopeMutationError extends TenancyError {
  constructor(column: string) {
    super('TENANCY_SCOPE_IMMUTABLE', `Tenancy scope column ${column} cannot be changed by update`);
  }
}

/** Thrown when a bypass is boolean, malformed, unaudited, or otherwise not explicitly authorized. */
export class UnauthorizedTenancyBypassError extends TenancyError {
  constructor(reason = 'A structured, authorized, and auditable tenancy bypass grant is required') {
    super('TENANCY_BYPASS_UNAUTHORIZED', reason);
  }
}
