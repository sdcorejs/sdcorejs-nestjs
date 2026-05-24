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
  // v0.1 preview: 80% threshold; bump to 90% in v1.0 once API stabilizes.
  coverageThreshold: {
    global: {
      branches: 70,
      lines: 80,
      functions: 80,
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
