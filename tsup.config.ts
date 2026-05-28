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
];

const baseConfig: Options = {
  entry: entryMap,
  splitting: false,
  sourcemap: true,
  dts: false,
  target: 'es2022',
  treeshake: true,
  external,
  keepNames: true,
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
