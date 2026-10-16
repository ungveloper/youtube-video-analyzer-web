import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(
  'lib/server/free-text-fallback.ts','utf8'
);

const compiled=ts.transpileModule(source,{
  compilerOptions:{
    target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.CommonJS
  }
});

const lib={};
Function('require','exports',compiled.outputText)(
  ()=>{throw new Error('Unexpected import');},lib
);

const choose=lib.freeTextFallbackModel;

assert.equal(
  choose('gemini-3.8-flash','PROVIDER_BUSY'),
  'gemini-3.5-flash-lite'
);
assert.equal(
  choose('gemini-3.8-flash','TIMEOUT'),
  'gemini-3.5-flash-lite'
);
assert.equal(choose('gemini-3.8-flash','FREE_LIMIT'),null);
assert.equal(choose('gemini-3.5-flash-lite','PROVIDER_BUSY'),null);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-single-pass'/);
assert.match(ai,/captionOneCallPrompt\(/);
assert.match(ai,/preserveTimedCaptionTimeline/);
assert.match(ai,/providerCalls:1/);

console.log('PASS: Gemini 무료 모델 장애 복구');
