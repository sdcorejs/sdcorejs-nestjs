import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const policy=JSON.parse(fs.readFileSync(new URL('./core-release-audit-policy.json',import.meta.url),'utf8'));
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw new Error(code);};
export function sourceHash(dir){
 const visit=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(path.join(d,e.name)):[path.join(d,e.name)]);
 return hash(visit(path.join(dir,'src')).map(file=>[path.relative(dir,file).replaceAll('\\','/'),hash(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)).replaceAll('\r\n','\n'))]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([name,sha])=>name+'\0'+sha+'\n').join(''));
}
export function evaluateAudit({report,exit,lock,pkg,runtimeSourceHash,now,scope}){
 if(!Number.isFinite(now)||now<Date.parse(policy.approvedAt)||now>=Date.parse(policy.expiresAt))fail('AUDIT_EXCEPTION_EXPIRED_OR_CLOCK');
 if(pkg.name!==policy.package||!policy.versions.includes(pkg.version)||runtimeSourceHash!==policy.runtimeSourceHash)fail('AUDIT_EXCEPTION_SOURCE_SCOPE');
 if(!['root','production','site'].includes(scope)||![0,1].includes(exit)||report?.error||report?.auditReportVersion!==2||!report.vulnerabilities||Array.isArray(report.vulnerabilities)||typeof report.vulnerabilities!=='object')fail('AUDIT_REPORT_INVALID');
 const counts=report.metadata?.vulnerabilities;
 if(!counts||['info','low','moderate','high','critical','total'].some(k=>!Number.isInteger(counts[k])||counts[k]<0)||counts.total!==Object.keys(report.vulnerabilities).length||counts.total!==counts.info+counts.low+counts.moderate+counts.high+counts.critical)fail('AUDIT_REPORT_COUNTS');
 if(!counts.total){if(exit!==0)fail('AUDIT_EXIT_INVALID');return{decision:'PASS',scope,findings:0};}
 if(scope!=='root'||exit!==1)fail('AUDIT_NONEXEMPT_FINDING');
 if(counts.low!==counts.total||counts.info||counts.moderate||counts.high||counts.critical)fail('AUDIT_SEVERITY_COUNTS');
 const seen=new Set();
 function check(name){
  if(seen.has(name))return;
  const v=report.vulnerabilities[name],allowed=policy.chain.find(x=>x.name===name);
  if(!v||!allowed||v.name!==name||v.severity!=='low'||!Array.isArray(v.nodes)||v.nodes.length!==1||v.nodes[0]!==allowed.path||!Array.isArray(v.via)||!v.via.length)fail('AUDIT_FINDING_OUTSIDE_EXCEPTION');
  const p=lock.packages?.[allowed.path];
  if(!p||p.dev!==true||p.version!==allowed.version||p.integrity!==allowed.integrity)fail('AUDIT_DEPENDENCY_CLASSIFICATION');
  seen.add(name);
  for(const via of v.via){
   if(typeof via==='string'){if(!allowed.via.includes(via)||via===name)fail('AUDIT_DEPENDENCY_EDGE');check(via);}
   else if(!via||name!=='deepmerge'||via.name!=='deepmerge'||via.dependency!=='deepmerge'||via.url!==policy.advisory||via.severity!=='low')fail('AUDIT_ADVISORY_OUTSIDE_EXCEPTION');
  }
  if(name==='deepmerge'&&(v.via.length!==1||typeof v.via[0]!=='object'))fail('AUDIT_ROOT_ADVISORY_INVALID');
 }
 for(const name of Object.keys(report.vulnerabilities))check(name);
 if(!seen.has('deepmerge'))fail('AUDIT_ROOT_ADVISORY_MISSING');
 return{decision:'ACCEPTED_WITH_TIME_LIMITED_EXCEPTION',scope,findings:counts.total,advisory:policy.advisory,expiresAt:policy.expiresAt,release:policy.release};
}

export function assertPublicationWindow({pkg,runtimeSourceHash,now}){
 if(!Number.isFinite(now)||now<Date.parse(policy.approvedAt)||now>=Date.parse(policy.expiresAt))fail('AUDIT_EXCEPTION_EXPIRED_OR_CLOCK');
 if(pkg.name!==policy.package||pkg.version!==policy.release||runtimeSourceHash!==policy.runtimeSourceHash)fail('PUBLISH_RELEASE_SCOPE');
 return{release:policy.release,at:new Date(now).toISOString(),expiresAt:policy.expiresAt};
}
export function runReleaseAudit({cwd=root,run=spawnSync,clock=Date.now}={}){
 const output=path.join(cwd,'test-results','release-audit');fs.mkdirSync(output,{recursive:true});
 const pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8')),lock=JSON.parse(fs.readFileSync(path.join(cwd,'package-lock.json'),'utf8')),runtimeSourceHash=sourceHash(cwd),receipts=[];
 const npm=process.platform==='win32'?'npm.cmd':'npm';
 for(const scope of ['root','production','site']){
  const args=['audit','--json',...(scope==='production'?['--omit=dev']:scope==='site'?['--prefix','site']:[])];
  const result=run(npm,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:16e6});
  fs.writeFileSync(path.join(output,scope+'.json'),result.stdout??'');
  const now=clock(),receipt={scope,at:new Date(now).toISOString(),rawExit:result.status,rawReportSha256:hash(result.stdout??''),runtimeSourceHash,decision:'BLOCKED'};
  try{
   if(result.error||result.signal)fail('AUDIT_COMMAND_FAILED');
   let report;try{report=JSON.parse(result.stdout);}catch{fail('AUDIT_REPORT_INVALID');}
   Object.assign(receipt,evaluateAudit({report,exit:result.status,lock,pkg,runtimeSourceHash,now,scope}));
  }catch(error){receipt.reason=error.message;throw error;}
  finally{receipts.push(receipt);fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipts,null,2)+'\n');}
 }
 return receipts;
}

export function checkPackedRuntime({cwd=root,run=spawnSync}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'core-release-pack-'));
 const npm=process.platform==='win32'?'npm.cmd':'npm';
 try{
  const packed=run(npm,['pack','--json','--ignore-scripts','--pack-destination',temp],{cwd,encoding:'utf8',timeout:120000,maxBuffer:16e6});
  if(packed.status!==0||packed.error)fail('PACK_COMMAND_FAILED');
  const [record]=JSON.parse(packed.stdout);if(!record||path.basename(record.filename)!==record.filename||!Array.isArray(record.files))fail('PACK_MANIFEST_INVALID');
  const archive=path.join(temp,record.filename),read=file=>{const r=run('tar',['-xOf',archive,'package/'+file],{cwd,encoding:'utf8',timeout:30000,maxBuffer:32e6});if(r.status!==0||r.error)fail('PACK_READ_FAILED');return r.stdout;};
  const pkg=JSON.parse(read('package.json'));
  for(const field of ['dependencies','optionalDependencies','peerDependencies','bundledDependencies','bundleDependencies']){const names=Array.isArray(pkg[field])?pkg[field]:Object.keys(pkg[field]??{});if(names.some(x=>/^(deepmerge|jest|jest-config|@jest\/|ts-jest)/.test(x)))fail('PACK_RUNTIME_DEPENDENCY_REFUSED');}
  for(const {path:file}of record.files){
   if(typeof file!=='string'||file.includes('..')||file.startsWith('/')||/(^|\/)(node_modules|test|tests)\/|(^|\/)jest\.config/.test(file))fail('PACK_CONTENT_REFUSED');
   if(file.startsWith('dist/')&&/\.(?:cjs|mjs|js|map)$/.test(file)&&/\bdeepmerge\b|jest-config|node_modules\/(?:@jest|jest|ts-jest)\//.test(read(file)))fail('PACK_BUNDLED_TOOLING_REFUSED');
  }
  const receipt={at:new Date().toISOString(),package:pkg.name,version:pkg.version,sha256:hash(fs.readFileSync(archive)),integrity:record.integrity,files:record.files.length,decision:'PASS_NO_TEST_TOOLING_IN_RUNTIME'};
  const out=path.join(cwd,'test-results','release-audit');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'packed-runtime.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
 }finally{if(path.dirname(fs.realpathSync(temp))!==fs.realpathSync(os.tmpdir()))fail('PACK_TEMP_SCOPE');fs.rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv[2]==='--publish-window'){
   const guard=()=>assertPublicationWindow({pkg:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),runtimeSourceHash:sourceHash(root),now:Date.now()});
   guard();const packed=checkPackedRuntime(),receipt={...guard(),packed};
   fs.writeFileSync(path.join(root,'test-results','release-audit','publish-guard.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  }
  else console.log(JSON.stringify({audits:runReleaseAudit(),packed:checkPackedRuntime()}));
 }
 catch(error){console.error(error.message);process.exitCode=1;}
}
