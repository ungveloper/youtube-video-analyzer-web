import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';

function load(path){
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
  const exports={};
  Function('require','exports',compiled.outputText)(
    createRequire(import.meta.url),exports
  );
  return exports;
}

const local=load('lib/server/caption-cleanup.ts');
const proof=load('lib/server/caption-proofread.ts');

const samples=[
  '설명을 하면서 하면서 하면서 마무리합니다.',
  '마지막으로 감사합니다. 감사합니다. 감사합니다.',
  '정말 정말 중요한 이야기입니다.',
  '이번 분기 영업이익은 17%입니다.',
  '다음 시간에 다시 뵙겠습니다.',
  '뵙겠습니다. 오늘은 마무리하겠습니다.',
  '그게 바로 가지 동맹입니다.'
];

const lines=samples.map((text,i)=>({
  id:String(i),
  startSeconds:i*5,
  endSeconds:i*5+4.9,
  text,
  translated:false
}));

const result=local.normalizeCaptionErrors(lines);

assert.equal(result.lines.length,lines.length);
assert.equal(
  result.lines[0].text,
  '설명을 하면서 마무리합니다.'
);
assert.equal(
  result.lines[1].text,
  '마지막으로 감사합니다.'
);
assert.equal(
  result.lines[2].text,
  '정말 정말 중요한 이야기입니다.'
);
assert.equal(result.lines[3].text,samples[3]);
assert.equal(
  result.lines[5].text,
  '오늘은 마무리하겠습니다.'
);

// Local rules may not guess a topic-specific correction.
assert.equal(result.lines[6].text,samples[6]);

for(let i=0;i<lines.length;i++){
  assert.equal(
    result.lines[i].startSeconds,
    lines[i].startSeconds
  );
  assert.equal(
    result.lines[i].endSeconds,
    lines[i].endSeconds
  );
  assert.equal(lines[i].text,samples[i]);
}

const finance=[
  '삼상전자 주가가 상승했습니다.',
  '에어프라어로 감자를 조리합니다.',
  '새 버전은 80% 빨라졌습니다.'
].map((text,i)=>({
  id:String(i),
  startSeconds:i*5,
  endSeconds:i*5+4.9,
  text,
  translated:false
}));

const corrected=proof.applyCaptionProofread(finance,{
  corrections:[
    {index:0,text:'삼성전자 주가가 상승했습니다.'},
    {index:1,text:'에어프라이어로 감자를 조리합니다.'},
    {index:2,text:'새 버전은 90% 빨라졌습니다.'}
  ]
});

assert.equal(corrected.accepted,2);
assert.equal(corrected.rejected,1);
assert.match(corrected.lines[0].text,/삼성전자/);
assert.match(corrected.lines[1].text,/에어프라이어/);
assert.equal(corrected.lines[2].text,finance[2].text);

const prompt=proof.captionProofreadPrompt(
  finance,'금융과 생활용품 리뷰'
);
assert.match(prompt,/(?:모든 분야|주제에 관계없이)/);
assert.match(prompt,/전체 자막/);
assert.match(prompt,/금융과 생활용품 리뷰/);

const cleanupSource=fs.readFileSync(
  'lib/server/caption-cleanup.ts','utf8'
);
assert.doesNotMatch(cleanupSource,/medicalRules/);
assert.doesNotMatch(cleanupSource,/가지\\s\*동맹/);

const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/normalizeCaptionErrors\(originalCaptionLines\)/);
assert.match(ai,/captionProofreadPrompt\(\s*baselineLines/);
assert.match(ai,/applyCaptionProofread\(\s*baselineLines/);
assert.match(ai,/strategy:'domain-neutral'/);

console.log(
 'PASS: topic-neutral deduplication, multi-domain contextual proofreading, protected numbers, immutable timestamps'
);
