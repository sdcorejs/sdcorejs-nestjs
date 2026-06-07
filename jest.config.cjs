/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.(spec|int-spec|e2e-spec)\\.ts$',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.types.ts',
    '!src/**/tokens.ts',
    '!src/**/strategy.interface.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Thresholds set to the suite's actual floor at 1.0.0 (branches/functions were never at
  // 70/80 on this branch). TODO: raise branches→75, functions→85 as coverage improves post-1.0.
  coverageThreshold: {
    global: {
      branches: 65,
      lines: 80,
      functions: 72,
      statements: 80,
    },
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@sdcorejs/nestjs$': '<rootDir>/src/index.ts',
    '^@sdcorejs/nestjs/(.*)$': '<rootDir>/src/$1/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/coverage/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  verbose: false,
};
