import { Injectable } from '@nestjs/common';

/**
 * Shares pending work by key within this instance and process. Does not cache settled
 * results, retry, cancel work, or coordinate across processes. Register as a provider
 * in the consumer's module, or own an instance for an independent namespace.
 *
 * Callers must include every trusted tenant/realm/client/credential-version/permission
 * boundary in their keys and use the same result type for each key. Keys are never logged.
 * A factory must not await its own flight, directly or through a dependency cycle.
 */
@Injectable()
export class SingleFlightService {
  private readonly flights = new Map<string, Promise<unknown>>();

  /** The first factory wins until settlement; it starts immediately after registration. */
  run<T>(key: string, factory: () => T | PromiseLike<T>): Promise<T> {
    const existing = this.flights.get(key);
    if (existing) return existing as Promise<T>;

    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const flight = pending.finally(() => {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    // Register before invoking user code, preserving eager invocation even on sync throws.
    this.flights.set(key, flight);
    try {
      resolve(factory());
    } catch (error) {
      reject(error);
    }
    return flight;
  }
}
