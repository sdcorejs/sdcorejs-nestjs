import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

const require = createRequire(import.meta.url);
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

const loadCjs = () => ({
  root: require('@sdcorejs/nestjs'),
  core: require('@sdcorejs/nestjs/core'),
  auth: require('@sdcorejs/nestjs/auth'),
  services: require('@sdcorejs/nestjs/services'),
  features: require('@sdcorejs/nestjs/features'),
});

const loadEsm = async () => {
  const [root, core, auth, services, features] = await Promise.all([
    import('@sdcorejs/nestjs'),
    import('@sdcorejs/nestjs/core'),
    import('@sdcorejs/nestjs/auth'),
    import('@sdcorejs/nestjs/services'),
    import('@sdcorejs/nestjs/features'),
  ]);
  return { root, core, auth, services, features };
};

function explicitDependency(ctor, index) {
  const dependencies = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ctor) ?? [];
  return dependencies.find((dependency) => dependency.index === index)?.param;
}

function assertSharedIdentity(format, { root, core, auth, services, features }) {
  assert.strictEqual(root.ContextService, core.ContextService, `${format}: root and /core must share ContextService`);
  assert.strictEqual(
    root.CONTEXT_IDENTITY_CONFIG,
    core.CONTEXT_IDENTITY_CONFIG,
    `${format}: root and /core must share CONTEXT_IDENTITY_CONFIG`,
  );
  assert.strictEqual(
    explicitDependency(auth.AuthGuard, 2),
    core.ContextService,
    `${format}: /auth AuthGuard must inject /core ContextService`,
  );
  assert.strictEqual(
    explicitDependency(auth.AuthGuard, 3),
    core.CONTEXT_IDENTITY_CONFIG,
    `${format}: /auth AuthGuard must inject /core identity configuration`,
  );
  assert.strictEqual(
    explicitDependency(services.CacheInterceptor, 1),
    core.ContextService,
    `${format}: /services CacheInterceptor must inject /core ContextService`,
  );
  assert.strictEqual(
    explicitDependency(services.HttpService, 1),
    core.ContextService,
    `${format}: /services HttpService must inject /core ContextService`,
  );
  assert.strictEqual(
    explicitDependency(features.UploadedFileService, 3),
    core.ContextService,
    `${format}: /features UploadedFileService must inject /core ContextService`,
  );
  assert.strictEqual(
    explicitDependency(features.ActionHistoryService, 1),
    core.ContextService,
    `${format}: /features ActionHistoryService must inject /core ContextService`,
  );
}

async function assertIdentityConflict(format, { core, auth }) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      core.ContextModule.forRoot({
        identity: {
          principalResolver: async () => ({ userId: 'shared-user', tenant: 'tenant-b' }),
          trustedHeaders: { isTrustedRequest: () => true },
        },
      }),
    ],
    providers: [
      Reflector,
      auth.AuthGuard,
      {
        provide: auth.PERMISSION_STRATEGY,
        useValue: { load: async () => [], check: () => true },
      },
    ],
  }).compile();

  try {
    const context = moduleRef.get(core.ContextService);
    const guard = moduleRef.get(auth.AuthGuard);
    const request = { user: { opaque: true } };
    const handler = () => undefined;
    class SmokeController {}
    const executionContext = {
      getHandler: () => handler,
      getClass: () => SmokeController,
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await assert.rejects(
      () =>
        context.run(
          {
            userId: 'shared-user',
            tenant: 'tenant-a',
            identitySource: 'trusted-headers',
          },
          () => guard.checkPermissions(executionContext),
        ),
      (error) => error?.getStatus?.() === 401 && error?.getResponse?.()?.code === 'core.context.identity-conflict',
      `${format}: conflicting trusted-header and verified-principal identities must be rejected`,
    );
  } finally {
    await moduleRef.close();
  }
}

for (const [format, modules] of [
  ['CJS', loadCjs()],
  ['ESM', await loadEsm()],
]) {
  assertSharedIdentity(format, modules);
  await assertIdentityConflict(format, modules);
}

console.log('Package DI identity smoke passed for CJS and ESM.');
