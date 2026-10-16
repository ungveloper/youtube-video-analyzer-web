import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const file='lib/server/caption-edit-guard.ts';
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

const guard={};
Function('exports','require',compiled.outputText)(
  guard,()=>{throw Error('Unexpected runtime import');}
);

const cues=[
  {id:'c0',startSeconds:0,endSeconds:4,
    text:'하지만 이 기능은 유용합니다.',translated:false},
  {id:'c1',startSeconds:4,endSeconds:8,
    text:'하지만이 기능은 아직 부족합니다.',translated:false},
  {id:'c2',startSeconds:8,endSeconds:12,
    text:'새 도구를 소개합니다.',translated:false}
];

const proposed={
  corrections:[
    {index:0,before:'하지만 이',after:'하지만이'},
    {index:2,before:'새 도구',after:'새로운 도구'},
    {index:2,before:'도구를',after:'도구를'}
  ]
};
const filtered=guard.guardCaptionCorrections(cues,proposed);
assert.equal(filtered.blockedSpacing,1);
assert.equal(filtered.parsed.corrections.length,2);
assert.equal(proposed.corrections.length,3);
assert.equal(cues[0].text,'하지만 이 기능은 유용합니다.');

const repaired=guard.repairCaptionConjunctionSpacing(cues);
assert.equal(repaired[0].text,'하지만 이 기능은 유용합니다.');
assert.equal(repaired[1].text,'하지만 이 기능은 아직 부족합니다.');
assert.equal(repaired[2].text,cues[2].text);
assert.deepEqual(
  repaired.map(x=>[x.startSeconds,x.endSeconds]),
  cues.map(x=>[x.startSeconds,x.endSeconds])
);

const evidence=[
 {id:'caption-1',kind:'caption',
  startSeconds:0,endSeconds:8,
  note:cues[0].text+' '+cues[1].text},
 {id:'caption-2',kind:'caption',
  startSeconds:8,endSeconds:12,
  note:cues[2].text}
];
const before={
  transcript:cues,
  evidence,
  claims:evidence.map((e,i)=>({
    id:'quote-'+(i+1),
    text:e.note,
    category:'원문 발화',
    evidenceIds:[e.id]
  })),
  exclusions:[]
};

const corrected={
 transcript:repaired,
 evidence:evidence.map((entry,i)=>
   i===0?{...entry,note:
     repaired[0].text+' '+repaired[1].text}:entry
 ),
 claims:before.claims.map((c,i)=>
   i===0?{...c,text:
     repaired[0].text+' '+repaired[1].text}:c
 ),
 exclusions:[]
};
const audit=guard.auditCaptionReconciliation(
  before,corrected,repaired
);
assert.equal(audit.synchronized,true);
assert.equal(audit.evidenceChanged,1);
assert.equal(audit.claimChanged,1);
assert.equal(audit.transcriptChanged,1);
assert.equal(audit.groupsChecked,2);

const fake={
 ...corrected,
 evidence:before.evidence
};
assert.equal(
 guard.auditCaptionReconciliation(
   before,fake,repaired
 ).synchronized,false
);
const identical=guard.auditCaptionReconciliation(
  before,before,cues
);
assert.equal(identical.evidenceChanged,0);
assert.equal(identical.synchronized,true);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
const start=ai.indexOf('    if(captions){');
const end=ai.indexOf(
  "  if(depth==='deep' || captionText?.trim())",start
);
assert(start>=0&&end>start);
const branch=ai.slice(start,end);
assert.equal(
  (branch.match(/await interaction\(/g)||[]).length,
  1
);
assert.match(branch,/guardCaptionCorrections\(/);
assert.match(branch,/repairCaptionConjunctionSpacing\(/);
assert.match(branch,/auditCaptionReconciliation\(/);
assert.match(branch,/evidenceChanged:/);
assert.match(branch,/evidenceSyncValid:/);
assert.match(branch,/timecodesPreserved/);
assert.doesNotMatch(branch,/pass:'caption-proofread-review'/);
assert.doesNotMatch(source,/aFmUl65-2-c|버거씨병|카트의 몸/);

console.log(
 'PASS v5.13: one request, preserved Korean spacing, safe local grammar, audited source evidence and unchanged timecodes'
);
