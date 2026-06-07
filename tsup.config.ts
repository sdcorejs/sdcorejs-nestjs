import { esbuildDecorators } from '@anatine/esbuild-decorators';
import { defineConfig, type Options } from 'tsup';

const entryMap: Record<string, string> = {
  index: 'src/index.ts',
  'orm/index': 'src/orm/index.ts',
  'context/index': 'src/context/index.ts',
  'tenancy/index': 'src/tenancy/index.ts',
  'audit/index': 'src/audit/index.ts',
  'permission/index': 'src/permission/index.ts',
  'cache/index': 'src/cache/index.ts',
  'http/index': 'src/http/index.ts',
  'jwt/index': 'src/jwt/index.ts',
  'validation/index': 'src/validation/index.ts',
  'queue/index': 'src/queue/index.ts',
  'i18n/index': 'src/i18n/index.ts',
  'entities/index': 'src/entities/index.ts',
  'action-history/index': 'src/action-history/index.ts',
  'uploaded-file/index': 'src/uploaded-file/index.ts',
  'job-scheduler/index': 'src/job-scheduler/index.ts',
};

const external = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/passport',
  'typeorm',
  'reflect-metadata',
  'rxjs',
  'passport',
  'passport-jwt',
  'axios',
  'zod',
  'jwks-rsa',
  'jsonwebtoken',
  '@nestjs/bullmq',
  'bullmq',
  '@nestjs/typeorm',
  'aws-sdk',
];

const baseConfig: Options = {
  entry: entryMap,
  splitting: false,
  sourcemap: true,
  dts: true,
  target: 'es2022',
  treeshake: true,
  external,
  keepNames: true,
  // esbuild drops `emitDecoratorMetadata`; this plugin restores it so NestJS type-based DI
  // and TypeORM column-type inference work in the bundled output.
  esbuildPlugins: [esbuildDecorators({ tsconfig: 'tsconfig.json' })],
};

export default defineConfig([
  {
    ...baseConfig,
    outDir: 'dist/esm',
    format: 'esm',
    outExtension: () => ({ js: '.mjs' }),
    clean: true,
  },
  {
    ...baseConfig,
    outDir: 'dist/cjs',
    format: 'cjs',
    outExtension: () => ({ js: '.cjs' }),
    clean: false,
  },
]);
