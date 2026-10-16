import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const path='lib/server/caption-context-reconcile.ts';
const source=fs.readFileSync(path,'utf8');
const compiled=ts.transpileModule(source,{
  fileName:path,
  compilerOptions:{
    target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.CommonJS
  },
  reportDiagnostics:true
});
assert.equal(compiled.diagnostics?.length??0,0);
const exported={};
Function('exports','require',compiled.outputText)(
  exported,()=>{throw Error('Unexpected runtime dependency');}
);

const original=[
  {id:'a',startSeconds:0,endSeconds:4,
   text:'새 플랫폼이라는 기능이 있습니다.',translated:false},
  {id:'b',startSeconds:4,endSeconds:9,
   text:'모든 기능을 소개하겠습니다.',translated:false},
  {id:'c',startSeconds:10,endSeconds:14,
   text:'카페라는 곳에서 설명합니다.',translated:false}
];

const aiEdited=[
  {...original[0],text:'새 플랫픔라는 기능이 있습니다.'},
  {...original[1]},
  {...original[2],text:'음식점라는 곳에서 설명합니다.'}
];
const repaired=exported.repairCaptionQuotationParticles(
  original,aiEdited
);
assert.equal(repaired[0].text,'새 플랫픔이라는 기능이 있습니다.');
assert.equal(repaired[2].text,'음식점이라는 곳에서 설명합니다.');
assert.deepEqual(
  repaired.map(x=>[x.startSeconds,x.endSeconds]),
  original.map(x=>[x.startSeconds,x.endSeconds])
);
assert.equal(original[0].text,'새 플랫폼이라는 기능이 있습니다.');

const evidence=[
  {id:'caption-1',kind:'caption',
   startSeconds:0,endSeconds:9,
   note:original[0].text+' '+original[1].text},
  {id:'caption-2',kind:'caption',
   startSeconds:10,endSeconds:14,
   note:original[2].text}
];
const claims=evidence.map((e,i)=>({
  id:'quote-'+(i+1),
  text:e.note,
  evidenceIds:[e.id],
  category:'원문 발화'
}));
const ledger={
  evidence,claims,transcript:original,exclusions:[]
};
const synced=exported.reconcileCaptionSource(ledger,repaired);
assert.equal(
  synced.evidence[0].note,
  repaired[0].text+' '+repaired[1].text
);
assert.equal(synced.evidence[1].note,repaired[2].text);
assert.equal(synced.claims[0].text,synced.evidence[0].note);
assert.equal(synced.claims[1].text,synced.evidence[1].note);
assert.deepEqual(
  synced.evidence.map(e=>[e.id,e.startSeconds,e.endSeconds]),
  evidence.map(e=>[e.id,e.startSeconds,e.endSeconds])
);
assert.equal(synced.transcript[0].text,repaired[0].text);
assert.equal(ledger.evidence[0].note,evidence[0].note);
assert.equal(synced.claims[0].id,'quote-1');

const incompatible=repaired.map(line=>({...line}));
incompatible[1].endSeconds=11;
assert.equal(
  exported.reconcileCaptionSource(ledger,incompatible),
  ledger
);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
const start=ai.indexOf('    if(captions){');
const end=ai.indexOf(
  "  if(depth==='deep' || captionText?.trim())",start
);
assert(start>=0&&end>start);
const branch=ai.slice(start,end);
assert.equal(
  (branch.match(/await interaction\(/g)||[]).length,
  1,'Caption analysis must still use one Gemini call'
);
assert.match(branch,/pass:'caption-single-pass'/);
assert.match(branch,/repairCaptionQuotationParticles\(/);
assert.match(branch,/reconcileCaptionSource\(/);
assert.match(branch,/extractComposedContent\([\s\S]*?correctedSource/);
assert.match(branch,/recordFromContent\([\s\S]*?correctedSource\.evidence/);
assert.match(branch,/preserveTimedCaptionTimeline\(/);
assert.match(branch,/timecodesPreserved/);
assert.doesNotMatch(branch,/caption-proofread-review/);
const prompt=fs.readFileSync('lib/server/caption-one-call.ts','utf8');
assert.match(prompt,/조사·어미/);
assert.match(prompt,/문장 전체/);
assert.doesNotMatch(source,/aFmUl65-2-c|medicalRules/);
console.log(
  'PASS v5.12: one Gemini call, safe particle agreement, corrected evidence and claim text, stable IDs/timecodes, no topic-specific dictionary'
);
