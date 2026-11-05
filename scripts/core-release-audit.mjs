import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const policy = JSON.parse(fs.readFileSync(new URL('./core-release-audit-policy.json', import.meta.url), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new Error(code); };
const validIntegrity = (value) => typeof value === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value);
const text = (file) => new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)).replaceAll('\r\n', '\n');
export function sourceHash(dir) {
  const visit = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? visit(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
  return hash(visit(path.join(dir, 'src')).map((file) => [path.relative(dir, file).replaceAll('\\', '/'), hash(text(file))])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, sha]) => name + '\0' + sha + '\n').join(''));
}
export function releaseIdentity(cwd) {
  const visit = (folder) => fs.readdirSync(path.join(cwd, folder), { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? visit(folder + '/' + entry.name) : [folder + '/' + entry.name]);
  const inputs = ['package.json', 'package-lock.json', 'site/package.json', 'site/package-lock.json', 'backports/manifest.json',
    ...visit('scripts'), ...visit('tools')].sort();
  return {
    source: sourceHash(cwd),
    inputs: hash(inputs
      .map((name) => name + '\0' + hash(text(path.join(cwd, name))) + '\n').join('')),
  };
}
export function evaluateAudit({ report, exit, scope }) {
  if (!policy.scopes.includes(scope) || ![0, 1].includes(exit) || report?.error || report?.auditReportVersion !== 2 ||
      !report.vulnerabilities || Array.isArray(report.vulnerabilities) || typeof report.vulnerabilities !== 'object') fail('AUDIT_REPORT_INVALID');
  const counts = report.metadata?.vulnerabilities;
  if (!counts || ['info', 'low', 'moderate', 'high', 'critical', 'total'].some((key) => !Number.isInteger(counts[key]) || counts[key] < 0) ||
      counts.total !== Object.keys(report.vulnerabilities).length ||
      counts.total !== counts.info + counts.low + counts.moderate + counts.high + counts.critical) fail('AUDIT_REPORT_COUNTS');
  if (counts.total !== 0) fail('AUDIT_FINDINGS_BLOCK_RELEASE');
  if (exit !== 0) fail('AUDIT_EXIT_INVALID');
  return { decision: 'PASS', scope, findings: 0 };
}
export function assertPublicationWindow({ pkg, identity, receipts, packed, now }) {
  if (pkg?.name !== policy.package || !/^\d+\.\d+\.\d+$/.test(pkg?.version ?? '') || packed?.version !== pkg.version ||
      packed?.package !== pkg.name || packed?.decision !== 'PASS_NO_TEST_TOOLING_IN_RUNTIME') fail('PUBLISH_RELEASE_SCOPE');
  if (!validIntegrity(packed.integrity)) fail('PUBLISH_PACK_INTEGRITY_INVALID');
  if (!Number.isFinite(now) || !identity || !/^[a-f0-9]{64}$/.test(identity.source) || !/^[a-f0-9]{64}$/.test(identity.inputs)) fail('PUBLISH_IDENTITY_INVALID');
  if (!Array.isArray(receipts) || receipts.length !== policy.scopes.length) fail('PUBLISH_EVIDENCE_MISSING');
  for (const scope of policy.scopes) {
    const matches = receipts.filter((receipt) => receipt.scope === scope);
    if (matches.length !== 1) fail('PUBLISH_EVIDENCE_MISSING');
    const receipt = matches[0], at = Date.parse(receipt.at);
    if (receipt.decision !== 'PASS' || receipt.findings !== 0 || !Number.isFinite(at) || at > now || now - at > policy.maxEvidenceAgeMs) fail('PUBLISH_EVIDENCE_STALE_OR_FAILED');
    if (receipt.identity?.source !== identity.source || receipt.identity?.inputs !== identity.inputs) fail('PUBLISH_EVIDENCE_SCOPE');
    if (scope.startsWith('consumer-')) {
      if (!validIntegrity(receipt.integrity) || receipt.integrity !== packed.integrity) fail('PUBLISH_PACK_MISMATCH');
      if (receipt.postgres !== true) fail('PUBLISH_POSTGRES_EVIDENCE_MISSING');
    }
  }
  return { release: pkg.version, at: new Date(now).toISOString(), decision: 'PASS_ZERO_FINDINGS', identity };
}
// Invoke npm's JS entrypoint on Windows, without shell parsing or credential reads.
export function runCommand(command, args, options = {}) {
  if (command === 'npm' && process.platform === 'win32') {
    const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    return spawnSync(process.execPath, [cli, ...args], { windowsHide: true, ...options });
  }
  return spawnSync(command, args, { windowsHide: true, ...options });
}
export function runReleaseAudit({ cwd = root, run = runCommand, clock = Date.now } = {}) {
  const output = path.join(cwd, 'test-results/release-audit');
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(path.join(output, 'receipt.json'), { force: true });
  const identity = releaseIdentity(cwd), receipts = [];
  for (const scope of ['root', 'production', 'site']) {
    const args = ['audit', '--json', ...(scope === 'production' ? ['--omit=dev'] : scope === 'site' ? ['--prefix', 'site'] : [])];
    const result = run('npm', args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16e6 });
    fs.writeFileSync(path.join(output, scope + '.json'), result.stdout ?? '');
    const receipt = { scope, at: new Date(clock()).toISOString(), rawExit: result.status,
      rawReportSha256: hash(result.stdout ?? ''), identity, decision: 'BLOCKED' };
    try {
      if (result.error || result.signal) fail('AUDIT_COMMAND_FAILED');
      let report; try { report = JSON.parse(result.stdout); } catch { fail('AUDIT_REPORT_INVALID'); }
      Object.assign(receipt, evaluateAudit({ report, exit: result.status, scope }));
      if (JSON.stringify(releaseIdentity(cwd)) !== JSON.stringify(identity)) fail('AUDIT_INPUTS_CHANGED');
    } catch (error) { receipt.decision = 'BLOCKED'; receipt.reason = error.message; throw error; }
    finally { receipts.push(receipt); fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipts, null, 2) + '\n'); }
  }
  return receipts;
}
export function checkPackedRuntime({ cwd = root, run = runCommand } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-release-pack-'));
  try {
    const packed = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16e6 });
    if (packed.status !== 0 || packed.error || packed.signal) fail('PACK_COMMAND_FAILED');
    const [record] = JSON.parse(packed.stdout);
    if (!record || path.basename(record.filename) !== record.filename || !Array.isArray(record.files)) fail('PACK_MANIFEST_INVALID');
    const archive = path.join(temp, record.filename);
    const actualIntegrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
    if (!validIntegrity(record.integrity) || record.integrity !== actualIntegrity) fail('PACK_INTEGRITY_INVALID');
    const read = (file) => {
      const result = run('tar', ['-xOf', archive, 'package/' + file], { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 32e6 });
      if (result.status !== 0 || result.error || result.signal) fail('PACK_READ_FAILED');
      return result.stdout;
    };
    const pkg = JSON.parse(read('package.json'));
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
      const names = Array.isArray(pkg[field]) ? pkg[field] : Object.keys(pkg[field] ?? {});
      if (names.some((name) => /^(deepmerge|jest|jest-config|@jest\/|ts-jest)/.test(name))) fail('PACK_RUNTIME_DEPENDENCY_REFUSED');
    }
    for (const { path: file } of record.files) {
      if (typeof file !== 'string' || file.includes('..') || file.startsWith('/') || /(^|\/)(node_modules|test|tests|tools|backports)\/|(^|\/)jest\.config/.test(file)) fail('PACK_CONTENT_REFUSED');
      if (file.startsWith('dist/') && /\.(?:cjs|mjs|js|map)$/.test(file) && /\bdeepmerge\b|jest-config|node_modules\/(?:@jest|jest|ts-jest)\//.test(read(file))) fail('PACK_BUNDLED_TOOLING_REFUSED');
    }
    const receipt = { at: new Date().toISOString(), package: pkg.name, version: pkg.version,
      sha256: hash(fs.readFileSync(archive)), integrity: actualIntegrity, files: record.files.length, decision: 'PASS_NO_TEST_TOOLING_IN_RUNTIME' };
    const output = path.join(cwd, 'test-results/release-audit'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'packed-runtime.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally {
    if (path.dirname(fs.realpathSync(temp)) !== fs.realpathSync(os.tmpdir())) fail('PACK_TEMP_SCOPE');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const audits = runReleaseAudit(), packed = checkPackedRuntime();
    const consumers = JSON.parse(fs.readFileSync(path.join(root, 'test-results/release-audit/consumer-receipt.json')));
    const guard = assertPublicationWindow({ pkg: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))),
      identity: releaseIdentity(root), receipts: [...audits, ...consumers], packed, now: Date.now() });
    fs.writeFileSync(path.join(root, 'test-results/release-audit/publish-guard.json'), JSON.stringify(guard, null, 2) + '\n');
    console.log(JSON.stringify({ audits, packed, guard }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
