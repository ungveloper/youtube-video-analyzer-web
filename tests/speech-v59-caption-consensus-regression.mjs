import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(path){
  const compiled=ts.transpileModule(
    fs.readFileSync(path,'utf8'),
    {
      fileName:path,
      compilerOptions:{
        target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.CommonJS
      },
      reportDiagnostics:true
    }
  );

  assert.equal(compiled.diagnostics?.length??0,0);

  const result={};

  Function('require','exports',compiled.outputText)(
    ()=>{throw new Error('Unexpected import');},
    result
  );

  return result;
}

const guard=load('lib/server/caption-review-consensus.ts');
const proof=load('lib/server/caption-proofread.ts');

const lines=[
  '에어프라어로 감자를 조리합니다.',
  '새로운 그래픽 엔진을 설명합니다.',
  '카트의 몸을 기대어 걷습니다.',
  '말초동맥에 관해 설명합니다.',
  '성능이 80% 향상됐습니다.'
].map((text,i)=>({
  id:'sample-'+i,
  startSeconds:i*5,
  endSeconds:i*5+4,
  text,
  translated:false
}));

const primary={
  corrections:[
    {index:0,before:'에어프라어',after:'에어프라이어'},
    {index:1,before:'그래픽 엔진',after:'그래픽 장치'},
    {index:2,before:'카트의 몸',after:'카트에 몸'},
    {index:3,before:'말초동맥',after:'말초 동맥'},
    {index:4,before:'80%',after:'90%'}
  ]
};

const independent={
  corrections:[
    {index:0,before:'에어프라어',after:'에어프라이어'},
    {index:1,before:'그래픽 엔진',after:'게임 엔진'},
    {index:2,before:'카트의 몸',after:'카트에 몸'},
    {index:4,before:'80%',after:'90%'}
  ]
};

const original=JSON.stringify(lines);

const consensus=guard.captionCorrectionConsensus(
  primary,independent
);

assert.equal(consensus.primaryProposed,5);
assert.equal(consensus.reviewProposed,4);
assert.equal(consensus.withheld,1);

const fixed=proof.applyCaptionProofread(lines,{
  corrections:consensus.corrections
});

assert.equal(fixed.accepted,3);
assert.equal(fixed.rejected,1);
assert.match(fixed.lines[0].text,/에어프라이어/);
assert.equal(fixed.lines[1].text,lines[1].text);
assert.match(fixed.lines[2].text,/카트에 몸/);
assert.match(fixed.lines[3].text,/말초 동맥/);
assert.equal(fixed.lines[4].text,lines[4].text);

for(let i=0;i<lines.length;i++){
  assert.equal(fixed.lines[i].startSeconds,lines[i].startSeconds);
  assert.equal(fixed.lines[i].endSeconds,lines[i].endSeconds);
}

assert.equal(JSON.stringify(lines),original);

const ambiguous=guard.captionCorrectionConsensus({
  corrections:[
    {index:0,before:'원래 표현',after:'변경 A'},
    {index:0,before:'원래 표현',after:'변경 B'}
  ]
},{
  corrections:[
    {index:0,before:'원래 표현',after:'변경 A'}
  ]
});

assert.equal(ambiguous.corrections.length,0);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-single-pass'/);
assert.match(ai,/captionOneCallPrompt\(/);
assert.match(ai,/preserveTimedCaptionTimeline/);
assert.match(ai,/providerCalls:1/);

console.log(
  'PASS: independent caption agreement, conflict rejection, numeric protection, domain neutrality, immutable timestamps'
);
