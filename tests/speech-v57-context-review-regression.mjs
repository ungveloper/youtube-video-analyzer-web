import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';

const path='lib/server/caption-proofread.ts';
const source=fs.readFileSync(path,'utf8');

const js=ts.transpileModule(source,{
  compilerOptions:{
    target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.CommonJS
  },
  reportDiagnostics:true
});

assert.equal(js.diagnostics?.length??0,0);

const lib={};
Function('require','exports',js.outputText)(
  createRequire(import.meta.url),lib
);

const original=[
  '에어프러이어로 요리를 합니다.',
  '이번 주식시잔 흐름을 분석합니다.',
  '새로운 게임 캐릭텨를 소개합니다.',
  '성능이 80% 좋아졌습니다.'
].map((text,index)=>({
  id:'caption-'+index,
  startSeconds:index*5,
  endSeconds:index*5+4.5,
  text,
  translated:false
}));

const first=lib.applyCaptionProofread(original,{
  corrections:[
    {
      index:0,
      before:'에어프러이어',
      after:'에어프라이어'
    }
  ]
});

assert.equal(first.accepted,1);

const reviewPrompt=lib.captionProofreadReviewPrompt(
  first.lines,
  '요리·금융·게임 영상 교정 테스트'
);

assert.match(reviewPrompt,/연속해서 읽는 원문/);
assert.match(reviewPrompt,/시간 구간별 원문/);
assert.match(reviewPrompt,/에어프라이어/);
assert.match(reviewPrompt,/주식시잔/);
assert.match(reviewPrompt,/캐릭텨/);

const second=lib.applyCaptionProofread(first.lines,{
  corrections:[
    {
      index:1,
      before:'주식시잔',
      after:'주식시장'
    },
    {
      index:2,
      before:'캐릭텨',
      after:'캐릭터'
    },
    {
      index:3,
      before:'80%',
      after:'90%'
    }
  ]
});

assert.equal(second.accepted,2);
assert.equal(second.rejected,1);
assert.match(second.lines[0].text,/에어프라이어/);
assert.match(second.lines[1].text,/주식시장/);
assert.match(second.lines[2].text,/캐릭터/);
assert.equal(second.lines[3].text,original[3].text);

for(let i=0;i<original.length;i++){
  assert.equal(
    second.lines[i].startSeconds,
    original[i].startSeconds
  );
  assert.equal(
    second.lines[i].endSeconds,
    original[i].endSeconds
  );
  assert.equal(
    original[i].text,
    [
      '에어프러이어로 요리를 합니다.',
      '이번 주식시잔 흐름을 분석합니다.',
      '새로운 게임 캐릭텨를 소개합니다.',
      '성능이 80% 좋아졌습니다.'
    ][i]
  );
}

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-single-pass'/);
assert.match(ai,/captionOneCallPrompt\(/);
assert.match(ai,/preserveTimedCaptionTimeline/);
assert.match(ai,/providerCalls:1/);

console.log(
  'PASS: second-pass context review, multi-domain corrections, numeric guard, timestamp preservation'
);
