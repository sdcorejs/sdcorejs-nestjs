import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateAudit, policy, assertPublicationWindow, checkPackedRuntime } from './core-release-audit.mjs';
const testIntegrity = 'sha512-' + createHash('sha512').update('synthetic archive').digest('base64');

const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: {
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
} });
for (const scope of policy.scopes) {
  test(`${scope}: accepts only a complete clean report`, () => {
    assert.equal(evaluateAudit({ report: clean(), exit: 0, scope }).decision, 'PASS');
    assert.throws(() => evaluateAudit({ report: clean(), exit: 1, scope }), /AUDIT_EXIT_INVALID/);
  });
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    test(`${scope}: ${severity} findings block release without exception`, () => {
      const report = clean();
      report.vulnerabilities.deepmerge = { name: 'deepmerge', severity };
      report.metadata.vulnerabilities[severity] = 1;
      report.metadata.vulnerabilities.total = 1;
      assert.throws(() => evaluateAudit({ report, exit: 1, scope }), /AUDIT_FINDINGS_BLOCK_RELEASE/);
    });
  }
}
for (const [name, change] of [
  ['missing report', (v) => v.report = null],
  ['transport error', (v) => v.report.error = { code: 'network' }],
  ['unexpected exit', (v) => v.exit = 2],
  ['unknown scope', (v) => v.scope = 'unknown'],
  ['missing counts', (v) => delete v.report.metadata],
  ['inconsistent counts', (v) => v.report.metadata.vulnerabilities.total = 1],
  ['negative count', (v) => v.report.metadata.vulnerabilities.low = -1],
  ['unknown report version', (v) => v.report.auditReportVersion = 3],
  ['array findings', (v) => v.report.vulnerabilities = []],
]) test(`${name} fails closed`, () => {
  const value = { report: clean(), exit: 0, scope: 'root' }; change(value);
  assert.throws(() => evaluateAudit(value));
});
function publication() {
  const now = Date.parse('2026-11-05T10:00:00Z');
  const identity = { source: 'a'.repeat(64), inputs: 'b'.repeat(64) };
  return { now, pkg: { name: policy.package, version: '1.3.1' }, identity,
    packed: { package: policy.package, version: '1.3.1', integrity: testIntegrity, decision: 'PASS_NO_TEST_TOOLING_IN_RUNTIME' },
    receipts: policy.scopes.map((scope) => ({ scope, at: new Date(now).toISOString(), decision: 'PASS', findings: 0, identity: { ...identity }, integrity: testIntegrity, postgres: true })),
  };
}
test('publication requires five fresh clean scopes tied to the same inputs and tarball', () => {
  assert.equal(assertPublicationWindow(publication()).decision, 'PASS_ZERO_FINDINGS');
});
for (const [name, change] of [
  ['missing consumer evidence', (v) => v.receipts.pop()],
  ['duplicate evidence', (v) => v.receipts[4].scope = 'consumer-fresh'],
  ['expired evidence', (v) => v.now += policy.maxEvidenceAgeMs + 1],
  ['future evidence', (v) => v.now -= 1],
  ['invalid clock', (v) => v.now = NaN],
  ['source changed', (v) => v.identity.source = 'c'.repeat(64)],
  ['lock or manifest changed', (v) => v.identity.inputs = 'd'.repeat(64)],
  ['different packed bytes', (v) => v.packed.integrity = 'different'],
  ['different version', (v) => v.pkg.version = '1.3.2'],
  ['different package', (v) => v.pkg.name = 'another'],
  ['old exception outcome', (v) => v.receipts[0].decision = 'ACCEPTED_WITH_TIME_LIMITED_EXCEPTION'],
  ['nonzero finding count', (v) => v.receipts[0].findings = 1],
  ['missing runtime verification', (v) => delete v.packed.decision],
  ['all integrity fields absent', (v) => { delete v.packed.integrity; for (const receipt of v.receipts) delete receipt.integrity; }],
  ['malformed integrity', (v) => { v.packed.integrity = 'invalid'; for (const receipt of v.receipts) receipt.integrity = 'invalid'; }],
  ['consumer without PostgreSQL', (v) => v.receipts[3].postgres = false],
  ['missing PostgreSQL evidence', (v) => delete v.receipts[4].postgres],
]) test(`publication rejects ${name}`, () => {
  const value = publication(); change(value); assert.throws(() => assertPublicationWindow(value));
});
for (const mode of ['clean', 'dependency', 'bundle', 'config', 'tool-file', 'archive-error', 'missing-integrity', 'wrong-integrity']) test(`packed runtime boundary: ${mode}`, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pack-test-'));
  try {
    const run = (exe, args) => {
      if (args[0] === 'pack') {
        fs.writeFileSync(path.join(args.at(-1), 'core.tgz'), 'synthetic archive');
        return { status: 0, stdout: JSON.stringify([{ filename: 'core.tgz', integrity: mode === 'missing-integrity' ? undefined : mode === 'wrong-integrity' ? testIntegrity.replace('sha512-', 'sha512-A') : testIntegrity, files: [
          { path: 'package.json' }, { path: mode === 'config' ? 'jest.config.cjs' : mode === 'tool-file' ? 'tools/merge.cjs' : 'dist/index.cjs' },
        ] }]) };
      }
      if (mode === 'archive-error') return { status: 2, stdout: '' };
      return { status: 0, stdout: args.at(-1) === 'package/package.json' ? JSON.stringify({ name: policy.package, version: '1.3.1',
        dependencies: mode === 'dependency' ? { deepmerge: '4.3.1' } : {} }) : mode === 'bundle' ? "require('deepmerge')" : 'module.exports={};' };
    };
    if (mode === 'clean') assert.equal(checkPackedRuntime({ cwd, run }).decision, 'PASS_NO_TEST_TOOLING_IN_RUNTIME');
    else assert.throws(() => checkPackedRuntime({ cwd, run }));
  } finally {
    assert.equal(path.dirname(fs.realpathSync(cwd)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
