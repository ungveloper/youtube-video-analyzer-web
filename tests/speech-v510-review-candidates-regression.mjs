import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file){
  const result=ts.transpileModule(
    fs.readFileSync(file,'utf8'),{
      compilerOptions:{
        target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.CommonJS
      },
      reportDiagnostics:true
    }
  );
  assert.equal(result.diagnostics?.length??0,0);
  const exports={};
  Function('require','exports',result.outputText)(
    ()=>{throw new Error('Unexpected import');},
    exports
  );
  return exports;
}

const proof=load('lib/server/caption-proofread.ts');
const guard=load('lib/server/caption-review-consensus.ts');

const texts=[
  '에어프라어에서 요리합니다.',
  '새로운 반도체 구조를 설명합니다.',
  '주식시잔을 분석합니다.'
];

const lines=texts.map((text,index)=>({
  id:'test-'+index,
  startSeconds:index*5,
  endSeconds:index*5+4,
  text,
  translated:false
}));

const first={
  corrections:[
    {index:0,before:'에어프라어',after:'에어프라이어'},
    {index:1,before:'반도체',after:'전자기기'},
    {index:2,before:'주식시잔',after:'주식시장'}
  ]
};

const prompt=proof.captionProofreadReviewPrompt(
  lines,'요리·기술·금융',first
);

assert.match(prompt,/1차 교정 후보/);
assert.match(prompt,/에어프라이어/);
assert.match(prompt,/전자기기/);
assert.match(prompt,/주식시장/);
assert.match(prompt,/무조건 승인하지 않는다/);
assert.match(prompt,/후보 목록에 없는 새로운 변경/);

const reviewer={
  corrections:[
    {index:0,before:'에어프라어',after:'에어프라이어'},
    {index:2,before:'주식시잔',after:'주식시장'}
  ]
};

const agreement=guard.captionCorrectionConsensus(
  first,reviewer
);

assert.equal(agreement.corrections.length,2);
assert.equal(agreement.withheld,1);

const result=proof.applyCaptionProofread(
  lines,{corrections:agreement.corrections}
);

assert.equal(result.accepted,2);
assert.match(result.lines[0].text,/에어프라이어/);
assert.equal(result.lines[1].text,texts[1]);
assert.match(result.lines[2].text,/주식시장/);

for(let i=0;i<lines.length;i++){
  assert.equal(result.lines[i].startSeconds,lines[i].startSeconds);
  assert.equal(result.lines[i].endSeconds,lines[i].endSeconds);
}

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-single-pass'/);
assert.match(ai,/captionOneCallPrompt\(/);
assert.match(ai,/preserveTimedCaptionTimeline/);
assert.match(ai,/providerCalls:1/);

console.log(
 'PASS: review receives original candidates, validates individually, preserves timestamps'
);
