module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
    ecmaVersion: 2022,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-empty-function': ['warn', { allow: ['constructors'] }],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@shared/*'],
            message: 'KHÔNG được import @shared/* trong lib — phải inline types vào src/ hoặc redesign neutral.',
          },
          {
            group: ['@core/*'],
            message: 'KHÔNG được import @core/* — lib này không phụ thuộc be-masterdata.',
          },
          {
            group: ['cls-hooked'],
            message: 'KHÔNG dùng cls-hooked — dùng AsyncLocalStorage native từ Node.',
          },
        ],
      },
    ],
    'no-extend-native': 'error',
  },
  ignorePatterns: [
    'dist/',
    'coverage/',
    'node_modules/',
    '*.config.ts',
    '*.config.cjs',
    'tsup.config.ts',
    'jest.config.ts',
    '.sdcorejs/',
  ],
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.int-spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
