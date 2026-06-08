import 'reflect-metadata';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InternalGuard, INTERNAL_SECRET_HEADER } from '../internal.guard';
import type { IInternalSecretProvider } from '../internal-secret.provider';
import type { IInternalContextEnricher } from '../internal-context.enricher';

function execCtx(headers: Record<string, string | string[]>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('InternalGuard', () => {
  it('throws 500 when no secret provider is registered', async () => {
    const guard = new InternalGuard(undefined, undefined);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 's' }))).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws 403 when the header is missing', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a matching secret via getKey()', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'secret' }))).resolves.toBe(true);
  });

  it('rejects a wrong secret of equal length', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'secreX' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a secret of different length (constant-time length guard)', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'short' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a match against any key returned by getKeys() (rotation)', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'old', getKeys: () => ['old', 'new'] };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'new' }))).resolves.toBe(true);
  });

  it('uses the first value when the header arrives as an array', async () => {
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const guard = new InternalGuard(provider);
    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: ['secret', 'junk'] }))).resolves.toBe(true);
  });

  it('runs the enricher only AFTER the secret check passes', async () => {
    const enrich = jest.fn();
    const provider: IInternalSecretProvider = { getKey: () => 'secret' };
    const enricher: IInternalContextEnricher = { enrich };
    const guard = new InternalGuard(provider, enricher);

    await expect(guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'wrong!' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(enrich).not.toHaveBeenCalled();

    await guard.canActivate(execCtx({ [INTERNAL_SECRET_HEADER]: 'secret' }));
    expect(enrich).toHaveBeenCalledTimes(1);
  });
});
