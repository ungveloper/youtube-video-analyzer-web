import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const path='lib/server/caption-article-fallback.ts';
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

const lib={};
Function('require','exports',compiled.outputText)(
  ()=>{throw new Error('Unexpected runtime import');},
  lib
);

const topics=[
  'AI 모델의 새로운 기능을 소개합니다.',
  '실적 발표에서 매출 증가를 언급했습니다.',
  '조리 시간을 조정하는 방법을 설명합니다.',
  '게임 업데이트의 변경점을 안내합니다.',
  '마지막으로 시청자에게 감사 인사를 전합니다.'
];

const evidence=topics.map((note,i)=>({
  id:'source-'+i,
  kind:'caption',
  startSeconds:i*15,
  endSeconds:i*15+14,
  note
}));

const article=lib.captionArticleFromEvidence(evidence);

assert(article.length>0);
assert.equal(
  article.map(x=>x.text).join(' '),
  topics.join(' ')
);
assert.deepEqual(
  article.flatMap(x=>x.evidenceIds),
  evidence.map(x=>x.id)
);
assert.match(article[0].title,/시간 지정 원문/);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-single-pass'/);
assert.match(ai,/captionOneCallPrompt\(/);
assert.match(ai,/preserveTimedCaptionTimeline/);
assert.match(ai,/providerCalls:1/);

const ui=fs.readFileSync(
  'components/analysis-workspace.tsx','utf8'
);
assert.match(ui,/자막 기본 정리/);
assert.match(ui,/시간 지정 자막은 확보했지만/);

console.log(
 'PASS: full caption evidence recovery, domain neutrality, provider failure isolation and UI diagnostics'
);
