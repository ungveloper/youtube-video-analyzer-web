import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const file='lib/caption-reading-flow.ts';
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

const lib={};
Function('require','exports',compiled.outputText)(
  ()=>{throw new Error('Unexpected import');},
  lib
);

const samples=[
  {
    id:'a',
    text:'모델의 동작 원리를 설명하는 것을',
    start:19,
    end:33
  },
  {
    id:'b',
    text:'목표로 합니다. 다음은 실제 활용 사례입니다.',
    start:33,
    end:41
  },
  {
    id:'c',
    text:'자세한 내용을 살펴보겠습니다.',
    start:41,
    end:45
  }
];

const evidence=samples.map(x=>({
  id:'e-'+x.id,
  kind:'caption',
  startSeconds:x.start,
  endSeconds:x.end,
  note:x.text
}));

const items=samples.map(x=>({
  id:'t-'+x.id,
  text:x.text,
  evidenceIds:['e-'+x.id]
}));

const before=JSON.stringify({items,evidence});

const result=lib.readableCaptionTimeline(
  items,evidence
);

assert.equal(result.length,3);
assert.equal(
  result[0].text,
  '모델의 동작 원리를 설명하는 것을 목표로 합니다.'
);
assert.deepEqual(
  result[0].evidenceIds,
  ['e-a','e-b']
);
assert.equal(
  result[1].text,
  '다음은 실제 활용 사례입니다.'
);
assert.deepEqual(result[1].evidenceIds,['e-b']);

assert.equal(
  result[2].text,
  '자세한 내용을 살펴보겠습니다.'
);

assert.equal(
  result.map(x=>x.text).join(' '),
  items.map(x=>x.text).join(' ')
);

assert.equal(
  JSON.stringify({items,evidence}),
  before,
  'Original cues and timestamps must remain unchanged'
);

const distant=[
  {id:'x',text:'계속 이어지는 말',evidenceIds:['e-x']},
  {id:'y',text:'다른 내용입니다.',evidenceIds:['e-y']}
];

const spacedEvidence=[
  {id:'e-x',kind:'caption',startSeconds:0,endSeconds:3},
  {id:'e-y',kind:'caption',startSeconds:12,endSeconds:16}
];

assert.equal(
  lib.readableCaptionTimeline(
    distant,spacedEvidence
  ).length,
  2,
  'Do not combine distant cues'
);

const edited=[{...items[0],edited:true},...items.slice(1)];

assert.strictEqual(
  lib.readableCaptionTimeline(edited,evidence),
  edited,
  'Manual edits must not be regrouped'
);

const ui=fs.readFileSync(
  'components/detailed-analysis-list.tsx','utf8'
);

const exporter=fs.readFileSync(
  'lib/exporters.ts','utf8'
);

const prompt=fs.readFileSync(
  'lib/server/caption-proofread.ts','utf8'
);

assert.match(ui,/readableCaptionTimeline/);
assert.match(exporter,/readableCaptionTimeline/);
assert.match(prompt,/조사·어미·서술어 연결/);

console.log(
 'PASS: readable sentence continuity, source timestamps, evidence links, edit protection and generic context review'
);
