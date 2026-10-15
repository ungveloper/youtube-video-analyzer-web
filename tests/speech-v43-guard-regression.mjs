import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const load=(p)=>{
  const transpiled=ts.transpileModule(fs.readFileSync(p,'utf8'),{fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(transpiled.diagnostics?.length??0,0,p);
  const result={};Function('exports',transpiled.outputText)(result);return result;
};
const {finalizeSpeechTimeline}=load('lib/speech-finalize.ts');
const {planSpeechRepairWindows}=load('lib/speech-coverage-recovery.ts');
const {mergeSpeechSentences}=load('lib/speech-sentence-merge.ts');
const line=(start,end,text,id=`segment-0-${start}`)=>({startSeconds:start,endSeconds:end,text,id,translated:false});
// The provided 202s case: an overlap repeating the end of one incomplete
// sentence must form ONE sourced utterance, not two entries.
const one=finalizeSpeechTimeline([
  line(97,102,'오래 앉아 있거나 장거리 운전하는 직업인데 담배를 많이 피우시고 스트레스는 많은데 운동도 안 하시다가 결국 무릎 이하 동맥이 전부 폐색되는','segment-3-1'),
  line(101,107,'결국 무릎 이하 동맥이 전부 폐색되는 버거씨병으로 오시는 분도 있습니다.','coverage-101-2'),
],202);
assert.equal(one.lines.length,1);
assert.match(one.lines[0].text,/운동도 안 하시다가 결국 무릎 이하 동맥이 전부 폐색되는 버거씨병으로 오시는 분도 있습니다/);
assert.equal(one.lines[0].startSeconds,97);
assert.equal((one.lines[0].text.match(/결국 무릎 이하/g)||[]).length,1);
// Context from different listens that has no verbatim overlap must not be
// combined into an invented Frankenstein statement.
const independent=mergeSpeechSentences([
  line(128,132,'많은 환자분들이 허리 질환으로 혼동되곤 하는데','segment-3-1'),
  line(130,137,'그리고 다리의 온도도 비교가 됩니다.','coverage-119-2'),
],202);
assert.equal(independent.length,2,'cross-source text may not be concatenated solely from overlapping estimated timestamps');
// v4.2 transitive fuzzy-dedupe must not wipe out the opening 00:00–00:33
// or genuine new content in the discussion / conclusion.
const opening=[
 line(0,4,'흔히 동맥경화라고 하면 심장이나 뇌혈관 질환을 먼저 떠올립니다.','segment-0-0'),
 line(4,9,'하지만 이 질병의 80%가 다리에서 시작됩니다.','segment-0-1'),
 line(13,18,'심장에서 발끝까지 피를 보내는 통로, 그것이 바로 하지동맥입니다.','segment-0-2'),
 line(19,31,'콜레스테롤 등이 혈관 벽에 스며들면 혈관이 점점 좁아지게 됩니다.','segment-0-3'),
];
const mid=[
 line(127,131,'많은 환자분들이 허리 질환을 함께 호소합니다.','segment-3-5'),
 line(131,137,'그다음에 나이 드신 분들은 척추관 협착증 같은 허리 질환으로 많이 혼동되곤 합니다.','coverage-119-2'),
 line(138,143,'하지만 허리에 의한 질환과 동맥 폐색에 의한 질환은 엄격하게 구분합니다.','coverage-119-3'),
 line(146,152,'마트에서 허리를 굽혀 카트에 몸을 기대 걸으면 증상이 달라집니다.','coverage-119-4'),
];
const ending=[line(184,190,'우리 몸속에 있는 혈관 상수도도 한번 점검해 보시기 바랍니다.','segment-5-4'),line(194,198,'청맥병원 원장입니다. 감사합니다.','coverage-164-5')];
const kept=finalizeSpeechTimeline([...opening,...mid,...ending],202);
assert.equal(kept.lines.filter(x=>x.startSeconds<34).length,4,'All four independent opening statements survive');
assert(kept.lines.some(x=>x.text.includes('척추관 협착증')));
assert(kept.lines.some(x=>x.text.includes('카트')));
assert(kept.lines.some(x=>x.text.includes('감사합니다')));
// Adaptive recovery uses what is actually missing in THIS analysis. Do not
// burn both optional calls on central windows when the start has vanished.
const sparse=[line(34,40,'상수도 예시를 먼저 설명합니다.'),line(41,47,'이어서 다음 원인을 살펴보겠습니다.'),line(58,64,'원인에 대한 설명을 이어갑니다.'),line(70,80,'운동을 하다 보면 다양한 질환이 나타납니다.'),line(91,127,'환자분들의 다양한 사례를 말씀드리겠습니다.'),line(168,190,'예방과 일상적인 확인을 권해드립니다.')];
const windows=planSpeechRepairWindows(sparse,202);
assert(windows.length<=3);
assert(windows.some(w=>w.from<=4&&w.to>=33),'0:00–0:33 must be prioritized');
assert(windows.some(w=>w.from<=127&&w.to>=166),'2:07–2:48 central gap must be re-listened');
assert(windows.some(w=>w.to===202),'outro must get a review when the transcript ends prematurely');
for(const w of windows)assert(w.to-w.from<=52,'bounded Gemini requests only');
assert.equal(planSpeechRepairWindows(sparse,301).length,0);
const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/planSpeechRepairWindows\(finalLines,video\.durationSeconds\)/);
assert.match(ai,/event:'analysis\.speech_repair_plan'/);
assert.match(ai,/finalizeSpeechTimeline\(finalLines,video\.durationSeconds\)/);
const original=fs.readFileSync('lib/speech-coverage-recovery.ts','utf8');
assert(!original.includes('간헐적 파행')&&!original.includes('변승재'),'Reference words only in tests, not production');
console.log('PASS: preserves opening/middle/closing, joins overlapping clause, protects unrelated speech, adaptively schedules missing head/interior/outro');
