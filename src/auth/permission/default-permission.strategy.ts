import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from './strategy.interface';

/**
 * Deny-all default — every endpoint with `@HasPermission` rejects. Override via
 * `PermissionModule.forRoot({ strategy: MyPermissionStrategy })` to load real permissions
 * from your auth backend.
 */
@Injectable()
export class DefaultPermissionStrategy implements IPermissionStrategy {
  async load(): Promise<string[]> {
    return [];
  }
  check(codes: string[], required: string): boolean {
    return codes.includes(required);
  }
}
