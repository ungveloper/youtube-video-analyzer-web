import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const transpile=(filename)=>{
  const transpiled=ts.transpileModule(read(filename),{
    fileName:filename,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    reportDiagnostics:true,
  });
  assert.equal(transpiled.diagnostics?.length??0,0,`Invalid TypeScript in ${filename}`);
  return transpiled.outputText;
};
const retry={};
Function('exports',transpile('lib/provider-retry.ts'))(retry);
const recovery={};
Function('exports','require',transpile('lib/speech-clip-recovery.ts'))(recovery,(name)=>{
  assert.equal(name,'./provider-retry');
  return retry;
});
const {speechClipFailureCode,speechClipRetryDelayMs}=recovery;
assert.equal(speechClipRetryDelayMs('PROVIDER_BUSY',0),2400);
assert.equal(speechClipRetryDelayMs('PROVIDER_BUSY',1),4800);
assert.equal(speechClipRetryDelayMs('PROVIDER_BUSY',2),null);
for(const blocked of ['FREE_LIMIT','TIMEOUT','TEMPORARY_HTTP','INVALID_RESULT',undefined]){
  assert.equal(speechClipRetryDelayMs(blocked,0),null,`No retry for ${blocked}`);
}
assert.equal(speechClipFailureCode([{failure:'PROVIDER_BUSY'},{failure:'PROVIDER_BUSY'},{failure:'PROVIDER_BUSY'}]),'PROVIDER_BUSY');
assert.equal(speechClipFailureCode([{failure:'PROVIDER_BUSY'},{failure:'FREE_LIMIT'}]),'FREE_LIMIT');
assert.equal(speechClipFailureCode([{failure:'GOOGLE_REQUEST_REJECTED'},{failure:'PROVIDER_BUSY'}]),'GOOGLE_REQUEST_REJECTED');
assert.equal(speechClipFailureCode([{failure:'TIMEOUT'},{failure:'INVALID_RESULT'}]),'TIMEOUT');
assert.equal(speechClipFailureCode([{failure:'TEMPORARY_HTTP'}]),'PROVIDER_UNAVAILABLE');
assert.equal(speechClipFailureCode([{failure:'INVALID_RESULT'}]),'PROVIDER_UNAVAILABLE');
assert.equal(speechClipFailureCode([{parsed:{lines:[]}}]),'INVALID_RESULT');
const ai=read('lib/server/ai.ts');
assert.match(ai,/speechClipFailureCode\(outcomes\)/,'Empty clip results must preserve upstream error');
assert.match(ai,/speechClipRetryDelayMs\(outcome\.failure,consecutiveBusy\)/,'Only failed busy clips get bounded recovery');
assert.match(ai,/event:'analysis\.speech_clip_retry'/,'Log retry with request correlation');
assert.match(ai,/event:'analysis\.speech_clip_retry_failed'/,'Log retry failure without leaking provider body');
assert.match(ai,/waitBeforeProviderRetry\(signal,delayMs\)/,'Backoff must be cancellable');
assert.match(ai,/pass:`speech-clip-\$\{outcome\.segment\.index\}`/,'Retry original clip and original time offsets');
assert.match(ai,/if\(!source\.claims\.length\)/,'Never fabricate speech after total provider failure');
console.log('PASS: short speech clips 503 bounded sequential recovery; 429 hard stop; truthful upstream failure');
