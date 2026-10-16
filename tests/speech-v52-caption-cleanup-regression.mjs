import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';

const source=fs.readFileSync(
  'lib/server/caption-cleanup.ts','utf8'
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

const words=[
 '그게 바로 가지 동맹입니다.',
 '말초 동매 즉 다리부터 폐색이 발생합니다.',
 '담배로 생기는 혈관념이 있습니다.',
 '근육에 눌려서 포핵 중후가 발생합니다.',
 '무릎 뒤에 있는 스화 동맥을 눌렀습니다.',
 '동맥의 회색에 의해서 통증이 생깁니다.',
 '척추한 협착증 같은 허리 질환입니다.',
 '통증 신호를 보내면서 보내면서 보내면서 많이 걸 수가 없습니다.',
 '이건 단순한 필요에 의한 것이 아닙니다.',
 '한번 점검해 보시길 바랍니다.',
 '바랍니다. 바랍니다. 정맥병원 변승제 원장입니다.',
 '환자의 나이는 20대이며 발생률은 80%입니다.'
];

const lines=words.map((text,i)=>({
  id:'line-'+i,
  startSeconds:i*5,
  endSeconds:i*5+4.9,
  text,
  translated:false
}));

const result=lib.normalizeCaptionErrors(lines);

assert.equal(result.lines.length,lines.length);
assert.equal(result.lines[0].text,'그게 바로 하지 동맥입니다.');
assert.match(result.lines[1].text,/말초 동맥/);
assert.match(result.lines[2].text,/혈관염/);
assert.match(result.lines[3].text,/포획 증후군/);
assert.match(result.lines[4].text,/슬와 동맥/);
assert.match(result.lines[5].text,/동맥의 폐색/);
assert.match(result.lines[6].text,/척추관 협착증/);
assert.equal(
  result.lines[7].text,
  '통증 신호를 보내면서 많이 걸을 수가 없습니다.'
);
assert.match(result.lines[8].text,/단순한 피로/);
assert.equal(
  result.lines[10].text,
  '정맥병원 변승제 원장입니다.'
);
assert.equal(result.lines[11].text,words[11]);

for(let i=0;i<lines.length;i++){
  assert.equal(result.lines[i].startSeconds,lines[i].startSeconds);
  assert.equal(result.lines[i].endSeconds,lines[i].endSeconds);
  assert.equal(lines[i].text,words[i],'Input must stay immutable');
}

const ordinary=lib.normalizeCaptionErrors([{
  id:'ordinary',
  startSeconds:0,
  endSeconds:3,
  text:'오늘은 책을 읽고 산책을 했습니다.',
  translated:false
}]);
assert.equal(ordinary.changed,0);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/normalizeCaptionErrors\(originalCaptionLines\)/);
assert.match(ai,/text:captionProofreadPrompt\(\s*baselineLines/);
assert.match(ai,/applyCaptionProofread\(\s*baselineLines/);
assert.match(ai,/appliedCorrections\+=fixed.accepted/);
assert.match(ai,/event:'analysis.caption_local_cleanup'/);

console.log(
  'PASS: local terminology, duplicate removal, names/numbers unchanged, timestamps preserved, AI pipeline wired'
);
