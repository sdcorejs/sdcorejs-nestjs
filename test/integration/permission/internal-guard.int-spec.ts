import 'reflect-metadata';
import { type ExecutionContext, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InternalGuard } from '../../../src/permission/internal.guard';

const buildExecCtx = (headers: Record<string, string | string[] | undefined>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

describe('InternalGuard', () => {
  it('throws 500 when no provider registered (boot-safe, request-time fail)', async () => {
    const guard = new InternalGuard();
    await expect(guard.canActivate(buildExecCtx({ 'x-internal-secret': 'k' }))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws 403 with code body when header missing', async () => {
    const guard = new InternalGuard({ getKey: () => 'expected' });
    await expect(guard.canActivate(buildExecCtx({}))).rejects.toMatchObject({
      response: { code: 'core.permission.internal-secret-missing' },
    });
  });

  it('throws 403 with code body when header mismatches', async () => {
    const guard = new InternalGuard({ getKey: () => 'expected' });
    await expect(guard.canActivate(buildExecCtx({ 'x-internal-secret': 'wrong' }))).rejects.toMatchObject({
      response: { code: 'core.permission.internal-secret-mismatch' },
    });
  });

  it('passes when header matches provider key', async () => {
    const guard = new InternalGuard({ getKey: () => 'secret-abc' });
    expect(await guard.canActivate(buildExecCtx({ 'x-internal-secret': 'secret-abc' }))).toBe(true);
  });

  it('supports async provider', async () => {
    const guard = new InternalGuard({ getKey: async () => 'async-secret' });
    expect(await guard.canActivate(buildExecCtx({ 'x-internal-secret': 'async-secret' }))).toBe(true);
  });

  it('takes first value when header is array-valued', async () => {
    const guard = new InternalGuard({ getKey: () => 'k' });
    expect(await guard.canActivate(buildExecCtx({ 'x-internal-secret': ['k', 'other'] }))).toBe(true);
  });

  it('rejects ForbiddenException on length mismatch (no timing leak)', async () => {
    const guard = new InternalGuard({ getKey: () => 'short' });
    await expect(guard.canActivate(buildExecCtx({ 'x-internal-secret': 'longerstring' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
