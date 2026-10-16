import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';

const source=fs.readFileSync(
  'lib/server/caption-proofread.ts','utf8'
);
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

const samples=[
  '하지만이 제품의 처리 속도는 80% 증가했습니다.',
  '그게 바로 가지 동맹입니다.',
  '에어프라어로 감자를 조리합니다.',
  '삼상전자 주가가 상승했습니다.',
  'GPU의 성능을 설명합니다.',
  '정맥병원 변승제 원장입니다.'
];

const lines=samples.map((text,i)=>({
  id:String(i),
  startSeconds:i*5,
  endSeconds:i*5+4.9,
  text,
  translated:false
}));

const fixed=lib.applyCaptionProofread(lines,{
  corrections:[
    {index:0,before:'하지만이',after:'하지만 이'},
    {index:1,before:'가지 동맹',after:'하지 동맥'},
    {index:2,before:'에어프라어',after:'에어프라이어'},
    {index:3,before:'삼상전자',after:'삼성전자'},
    {index:4,before:'GPU',after:'CPU'},
    {index:0,before:'80%',after:'90%'},
    {index:5,before:'정맥병원',after:'청맥병원'},
    {index:1,before:'존재하지 않는 단어',after:'새 단어'}
  ]
});

assert.equal(fixed.accepted,4);
assert.equal(fixed.rejected,4);
assert.match(fixed.lines[0].text,/하지만 이/);
assert.match(fixed.lines[1].text,/하지 동맥/);
assert.match(fixed.lines[2].text,/에어프라이어/);
assert.match(fixed.lines[3].text,/삼성전자/);
assert.equal(fixed.lines[4].text,samples[4]);
assert.equal(fixed.lines[5].text,samples[5]);

for(let i=0;i<lines.length;i++){
  assert.equal(fixed.lines[i].startSeconds,lines[i].startSeconds);
  assert.equal(fixed.lines[i].endSeconds,lines[i].endSeconds);
  assert.equal(lines[i].text,samples[i]);
}

const prompt=lib.captionProofreadPrompt(
  lines,'다양한 분야의 영상'
);
assert.match(prompt,/전체 자막/);
assert.match(prompt,/before/);
assert.match(prompt,/after/);
assert.match(prompt,/다양한 분야의 영상/);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-proofread'/);
assert.match(ai,/proposed:Array\.isArray\(rawCorrections\)/);
assert.match(ai,/preserveTimedCaptionTimeline\(result,captions\.srt,video\.durationSeconds\)/);

console.log(
  'PASS: contextual phrase patches, cross-domain examples, protected facts, timestamps'
);
