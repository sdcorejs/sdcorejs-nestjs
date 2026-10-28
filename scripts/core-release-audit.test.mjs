import {test} from 'node:test';import assert from 'node:assert/strict';
import {evaluateAudit,policy,assertPublicationWindow,checkPackedRuntime} from './core-release-audit.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const now=Date.parse('2026-10-28T10:00:00Z');
function fixture(){const chain=Object.fromEntries(policy.chain.map(p=>[p.path,{version:p.version,integrity:p.integrity,dev:true}]));return{now,scope:'root',exit:1,pkg:{name:policy.package,version:'1.3.0'},runtimeSourceHash:policy.runtimeSourceHash,lock:{packages:chain},report:{auditReportVersion:2,metadata:{vulnerabilities:{info:0,low:6,moderate:0,high:0,critical:0,total:6}},vulnerabilities:Object.fromEntries(policy.chain.map(p=>[p.name,{name:p.name,severity:'low',nodes:[p.path],via:p.name==='deepmerge'?[{name:'deepmerge',dependency:'deepmerge',url:policy.advisory,severity:'low'}]:p.via}]))}};}
test('only approved six dev nodes are accepted with explicit expiry and exception outcome',()=>{const r=evaluateAudit(fixture());assert.equal(r.decision,'ACCEPTED_WITH_TIME_LIMITED_EXCEPTION');assert.equal(r.findings,6);assert.equal(r.expiresAt,'2026-11-04T09:30:00Z');});
for(const [name,change]of[
 ['expired',v=>v.now=Date.parse(policy.expiresAt)],['before approval',v=>v.now=0],['invalid clock',v=>v.now=NaN],
 ['different release',v=>v.pkg.version='1.3.1'],['different source',v=>v.runtimeSourceHash='0'.repeat(64)],
 ['production findings',v=>v.scope='production'],['documentation findings',v=>v.scope='site'],
 ['new advisory',v=>v.report.vulnerabilities.deepmerge.via[0].url='https://github.com/advisories/GHSA-new'],
 ['raised severity',v=>v.report.vulnerabilities.deepmerge.severity='moderate'],
 ['raised severity metadata',v=>{v.report.metadata.vulnerabilities.low=0;v.report.metadata.vulnerabilities.high=6;}],
 ['runtime dependency',v=>v.lock.packages['node_modules/deepmerge'].dev=false],
 ['changed version',v=>v.lock.packages['node_modules/deepmerge'].version='4.3.2'],
 ['changed integrity',v=>v.lock.packages['node_modules/deepmerge'].integrity='other'],
 ['different path',v=>v.report.vulnerabilities.deepmerge.nodes=['node_modules/other/deepmerge']],
 ['unapproved edge',v=>v.report.vulnerabilities.jest.via=['deepmerge']],
 ['missing advisory',v=>v.report.vulnerabilities.deepmerge.via=[]],
 ['missing counts',v=>delete v.report.metadata],['inconsistent counts',v=>v.report.metadata.vulnerabilities.total=0],
 ['transport error',v=>v.report.error={code:'network'}],['unexpected exit',v=>v.exit=2],
 ['missing report',v=>v.report=null],
])test(name+' fails closed',()=>{const v=fixture();change(v);assert.throws(()=>evaluateAudit(v));});
for(const scope of['root','production','site'])test('clean '+scope+' report remains PASS without exception',()=>{const v=fixture();v.scope=scope;v.exit=0;v.report.vulnerabilities={};for(const k of Object.keys(v.report.metadata.vulnerabilities))v.report.metadata.vulnerabilities[k]=0;assert.equal(evaluateAudit(v).decision,'PASS');v.exit=1;assert.throws(()=>evaluateAudit(v));});
test('publish guard permits only exact1.3.0 in the approved source/time window',()=>{const v=fixture();assert.equal(assertPublicationWindow(v).release,'1.3.0');v.pkg.version='1.2.3';assert.throws(()=>assertPublicationWindow(v));v.pkg.version='1.3.0';v.now=Date.parse(policy.expiresAt);assert.throws(()=>assertPublicationWindow(v));});
for(const mode of['clean','dependency','bundle','config','archive-error'])test('packed runtime boundary: '+mode,()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'core-pack-test-'));
 try{const run=(exe,args)=>{
  if(args[0]==='pack'){fs.writeFileSync(path.join(args.at(-1),'core.tgz'),'synthetic archive');return{status:0,stdout:JSON.stringify([{filename:'core.tgz',integrity:'synthetic',files:[{path:'package.json'},{path:mode==='config'?'jest.config.cjs':'dist/index.cjs'}]}])};}
  if(mode==='archive-error')return{status:2,stdout:''};
  return{status:0,stdout:args.at(-1)==='package/package.json'?JSON.stringify({name:policy.package,version:'1.3.0',dependencies:mode==='dependency'?{deepmerge:'4.3.1'}:{}}):mode==='bundle'?"require('deepmerge')":"module.exports={};"};
 };if(mode==='clean')assert.equal(checkPackedRuntime({cwd,run}).decision,'PASS_NO_TEST_TOOLING_IN_RUNTIME');else assert.throws(()=>checkPackedRuntime({cwd,run}));}
 finally{assert.equal(path.dirname(fs.realpathSync(cwd)),fs.realpathSync(os.tmpdir()));fs.rmSync(cwd,{recursive:true,force:true});}
});
