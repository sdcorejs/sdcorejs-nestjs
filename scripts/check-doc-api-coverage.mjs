import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(repositoryRoot, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repositoryRoot, { noEmit: true }, configPath);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();

const groups = {
  root: { entry: 'src/index.ts', docs: ['api/root.md'] },
  core: {
    entry: 'src/core/index.ts',
    docs: ['api/core/index.md', 'api/core/orm.md', 'api/core/context.md', 'api/core/tenancy.md', 'api/core/audit.md'],
  },
  auth: { entry: 'src/auth/index.ts', docs: ['api/auth/index.md', 'api/auth/jwt.md', 'api/auth/permissions.md'] },
  services: {
    entry: 'src/services/index.ts',
    docs: ['api/services/index.md', 'api/services/cache.md', 'api/services/http.md'],
  },
  validation: { entry: 'src/validation/index.ts', docs: ['api/validation.md'] },
  queue: { entry: 'src/queue/index.ts', docs: ['api/queue.md'] },
  i18n: { entry: 'src/i18n/index.ts', docs: ['api/i18n.md'] },
  features: {
    entry: 'src/features/index.ts',
    docs: ['api/features/index.md', 'api/features/uploaded-files.md', 'api/features/action-history.md', 'api/features/job-scheduler.md'],
  },
};

const locales = { en: 'site', vi: 'site/vi' };
const failures = [];
for (const [locale, docsRoot] of Object.entries(locales)) {
  for (const [name, group] of Object.entries(groups)) {
    const entry = resolve(repositoryRoot, group.entry);
    const source = program.getSourceFile(entry);
    if (!source) {
      failures.push(`${locale}/${name}: TypeScript entry not found: ${group.entry}`);
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) {
      failures.push(`${locale}/${name}: module symbol not resolved`);
      continue;
    }
    let documentation = '';
    for (const path of group.docs) {
      try {
        documentation += `\n${readFileSync(resolve(repositoryRoot, docsRoot, path), 'utf8')}`;
      } catch {
        failures.push(`${locale}/${name}: API page missing: ${docsRoot}/${path}`);
      }
    }
    const exports = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.getName())
      .filter((symbol) => symbol !== 'default')
      .sort();
    const missing = exports.filter(
      (symbol) => !new RegExp(`(^|[^A-Za-z0-9_$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_$]|$)`).test(documentation),
    );
    if (missing.length) failures.push(`${locale}/${name}: ${missing.length}/${exports.length} unreferenced exports: ${missing.join(', ')}`);
    else console.log(`${locale}/${name}: referenced ${exports.length}/${exports.length} public export symbols`);
  }
}

if (failures.length) {
  console.error(`API documentation symbol coverage failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('API documentation symbol coverage passed for all eight package entry points in English and Vietnamese.');
