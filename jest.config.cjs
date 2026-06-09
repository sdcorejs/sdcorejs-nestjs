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
  // Thresholds sit just under the suite's real coverage (stmts ~92.6 / branch ~78.7 /
  // funcs ~88 / lines ~94) with a small margin for variance. Raise as coverage improves.
  coverageThreshold: {
    global: {
      branches: 76,
      lines: 90,
      functions: 85,
      statements: 88,
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
