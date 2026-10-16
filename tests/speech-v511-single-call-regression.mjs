import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const file='lib/server/caption-one-call.ts';
const source=fs.readFileSync(file,'utf8');

const compiled=ts.transpileModule(source,{
  fileName:file,
  compilerOptions:{
    target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.CommonJS
  },
  reportDiagnostics:true
});

assert.equal(compiled.diagnostics?.length??0,0);

const mocks={
  captionProofreadFormat:{
    schema:{properties:{corrections:{type:'array'}}}
  },
  composedResponseFormat:{
    schema:{properties:{
      summary:{type:'array'},
      article:{type:'array'},
      exclusions:{type:'array'}
    }}
  }
};

const lib={};

Function('require','exports',compiled.outputText)(
  ()=>mocks,lib
);

assert.deepEqual(
  lib.captionOneCallFormat.schema.required,
  ['corrections','summary','article','exclusions']
);

const lines=[
  '에어프러이어로 요리를 합니다.',
  '이번 주식시잔 흐름을 분석합니다.',
  '새로운 캐릭텨가 등장합니다.',
  '마지막으로 시청자에게 감사합니다.'
].map((text,i)=>({
  id:'cue-'+i,
  startSeconds:i*5,
  endSeconds:i*5+4,
  text,
  translated:false
}));

const claims=lines.map((line,i)=>({
  id:'quote-'+(i+1),
  text:line.text,
  evidenceIds:['caption-'+(i+1)]
}));

const prompt=lib.captionOneCallPrompt(
  lines,{claims},
  '요리·금융·게임 영상',
  20
);

assert.match(prompt,/에어프러이어/);
assert.match(prompt,/주식시잔/);
assert.match(prompt,/캐릭텨/);
assert.match(prompt,/마지막으로 시청자에게/);
assert.match(prompt,/quote-4/);
assert.match(prompt,/summary/);
assert.match(prompt,/article/);
assert.match(prompt,/corrections/);
assert.match(prompt,/확인되지 않은/);

const ai=fs.readFileSync(
  'lib/server/ai.ts','utf8'
);

const begin=ai.indexOf('    if(captions){');
const end=ai.indexOf(
  "  if(depth==='deep' || captionText?.trim())"
);

assert(begin>=0 && end>begin);

const captionBranch=ai.slice(begin,end);

assert.equal(
  (captionBranch.match(/await interaction\(/g)||[]).length,
  1,
  'YouTube caption path must make exactly one Gemini request'
);

assert.match(
  captionBranch,/pass:'caption-single-pass'/
);

assert.doesNotMatch(
  captionBranch,
  /pass:'caption-proofread'|pass:'caption-proofread-review'/
);

assert.doesNotMatch(
  captionBranch,
  /await deepAnalysis\(/
);

assert.match(
  captionBranch,/providerCalls:1/
);

assert.match(
  captionBranch,/analysis\.caption_first_fallback/
);

assert.match(
  captionBranch,/preserveTimedCaptionTimeline/
);

assert.match(
  captionBranch,/rawCaptionTranscript=originalCaptionLines/
);

assert.match(
  captionBranch,/timecodesPreserved/
);

assert.doesNotMatch(
  source,/medicalRules|videoId===/
);

console.log(
  'PASS: one Gemini request for timed captions, integrated corrections/article, local timeline, no retry, full-source protection'
);
