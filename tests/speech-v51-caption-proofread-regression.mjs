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

const lines=[
  {
    id:'a',startSeconds:.12,endSeconds:4.64,
    text:'그게 바로 가지 동맹입니다.',translated:false
  },
  {
    id:'b',startSeconds:14.08,endSeconds:19,
    text:'포핵 중후이라는 것도 있습니다.',translated:false
  },
  {
    id:'c',startSeconds:19,endSeconds:23,
    text:'이 질병의 80%가 다리에서 시작됩니다.',translated:false
  },
  {
    id:'d',startSeconds:186.56,endSeconds:191.56,
    text:'정맥병원 변승제 원장입니다.',translated:false
  }
];

const result=lib.applyCaptionProofread(lines,{
  corrections:[
    {index:0,text:'그게 바로 하지 동맥입니다.'},
    {index:1,text:'포획 증후군이라는 것도 있습니다.'},
    {index:2,text:'이 질병의 90%가 다리에서 시작됩니다.'},
    {index:3,text:'청맥병원 변승제 원장입니다.'},
    {index:-1,text:'임의 삽입'}
  ]
});

assert.equal(result.accepted,2);
assert.equal(result.rejected,3);
assert.equal(result.lines.length,lines.length);
assert.equal(result.lines[0].text,'그게 바로 하지 동맥입니다.');
assert.equal(result.lines[1].text,'포획 증후군이라는 것도 있습니다.');
assert.equal(result.lines[2].text,lines[2].text);
assert.equal(result.lines[3].text,lines[3].text);

for(let i=0;i<lines.length;i++){
  assert.equal(result.lines[i].startSeconds,lines[i].startSeconds);
  assert.equal(result.lines[i].endSeconds,lines[i].endSeconds);
  assert.equal(lines[i].text,[
    '그게 바로 가지 동맹입니다.',
    '포핵 중후이라는 것도 있습니다.',
    '이 질병의 80%가 다리에서 시작됩니다.',
    '정맥병원 변승제 원장입니다.'
  ][i]);
}

const srt=lib.correctedLinesToSrt(result.lines);
assert.match(srt,/00:00:00,120 --> 00:00:04,640/);
assert.match(srt,/00:03:06,560 --> 00:03:11,560/);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/pass:'caption-proofread'/);
assert.match(ai,/captionProofreadPrompt\(/);
assert.match(ai,/applyCaptionProofread\(/);
assert.match(ai,/timecodesPreserved/);
assert.match(ai,/proofreadingFailure\?\.code==='FREE_LIMIT'/);
assert.match(ai,/preserveTimedCaptionTimeline\(result,captions\.srt,video\.durationSeconds\)/);
assert.match(ai,/rawCaptionTranscript=originalCaptionLines/);
assert.match(ai,/providerCalls\+=proofreadCalls/);

console.log('PASS: caption proofreading, timestamp preservation, numeric/institution guard, Gemini fallback wiring');
