import { Injectable, Module } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SingleFlightService } from '@sdcorejs/nestjs/utils';

@Injectable()
export class DiscoveryService {
  constructor(private readonly flights: SingleFlightService) {}

  read<T>(
    trusted: {
      tenant: string;
      realm: string;
      clientId: string;
      credentialVersion: string;
      permissionVersion: string;
      userId: string;
      permissions: string[];
      resourceId: string;
    },
    fetchAuthorized: () => Promise<T>,
  ): Promise<T> {
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          'discovery:v1',
          trusted.tenant,
          trusted.realm,
          trusted.clientId,
          trusted.credentialVersion,
          trusted.permissionVersion,
          trusted.userId,
          [...trusted.permissions].sort(),
          trusted.resourceId,
        ]),
      )
      .digest('hex');
    return this.flights.run(key, fetchAuthorized);
  }
}

@Module({ providers: [SingleFlightService, DiscoveryService] })
export class DiscoveryModule {}

import { CacheService } from '@sdcorejs/nestjs/services';

export async function cachedRead<T>(cache: CacheService, trustedScopedKey: string, fetchAuthorized: () => Promise<T>): Promise<T> {
  return cache.load(trustedScopedKey, fetchAuthorized, 60);
}
