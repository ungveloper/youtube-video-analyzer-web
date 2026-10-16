import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const file='lib/speech-finalize.ts';
const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(output.diagnostics?.length??0,0);
const imported={};Function('exports',output.outputText)(imported);
const {finalizeSpeechTimeline}=imported;
const L=(s,e,text,id=`segment-4-${s}`)=>({id,startSeconds:s,endSeconds:e,text,translated:false});
const checks=[
  // A later short ASR fragment replays the last part of an earlier full line.
  L(19,34,'그런데 혈액 속에 있는 기름기 즉 콜레스테롤이나 중성지방들이 혈관 벽에 스며들며 혈관이 점점 좁아지게 되는 것을 다리에 생기는 죽상동맥경화증이라고 합니다.','segment-0-0'),
  L(30,34,'다시 생기는 죽상동맥경화증이라고 합니다.','coverage-23-3'),
  // Lost source text must not be hallucinated. Preserve this unfinished clause.
  L(133,136,'많은 환자분들이 허리 질환,','segment-3-0'),
  L(135,140,'그렇듯 일상 생활에서 손쉽게 체크할 수 있으니 여러분의','coverage-119-1'),
  L(137,141,'협착증 같은 허리 질환으로 많이 혼동되곤 합니다.','segment-4-0'),
  L(139,145,'하지만 이런 허리에 의한 질환과 동맥 폐색에 의한 질환은 엄격하게 구분되지요.','segment-4-1'),
  L(145,152,'마트에서 허리를 굽혀 카트에 기대서 걸으시면 척추관 협착증 환자들은 어느 정도 증상이 호전됩니다.','segment-4-2'),
  L(154,159,'그리고 다리의 온도도 비교가 됩니다.','segment-4-3'),
  L(165,171,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의 다리에 이런 신호가 온다면 이것은 단순한 피로에 의한 것이 아니에요.','coverage-165-0'),
  L(173,179,'몸에 보내는 경고등이기도 합니다.','segment-5-0'),
  L(180,182,'혈관도 청소가 필요합니다.','segment-5-1'),
  L(183,189,'우리 몸속에 있는 혈관 상수도도 한번 점검해 보시길 바랍니다.','segment-5-2'),
  L(188,191,'정맥병원 변승재 원장입니다. 감사합니다.','coverage-164-5'),
  L(190,193,'정맥병원 변승재 원장입니다.','segment-5-5'),
];
const result=finalizeSpeechTimeline(checks,202);
const out=result.lines;
assert(!out.some(x=>x.text.startsWith('다시 생기는 죽상동맥경화증')),'00:30 tail echo removed');
assert(!out.some(x=>x.startSeconds===135&&x.text.includes('일상 생활에서')),'02:15 incorrectly early version removed when complete text survives later');
assert(out.some(x=>x.startSeconds===165&&x.text.includes('단순한 피로')),'proper 02:45 complete ending preserved');
assert(out.some(x=>x.text.startsWith('많은 환자분들이 허리 질환')),'02:13 genuinely different unfinished phrase is retained, not invented');
assert(out.some(x=>x.text.startsWith('협착증 같은 허리 질환')),'02:17 later separate phrase is retained');
assert(out.some(x=>x.text.startsWith('하지만 이런 허리')),'contrast words are retained');
assert(out.some(x=>x.text.includes('카트에 기대서')),'cart analogy retained');
assert.equal(out.filter(x=>x.text.includes('변승재 원장입니다')).length,1,'duplicated goodbye removed');
const clippedEnding=finalizeSpeechTimeline([
 L(157,165,'어떤 경우는 털도 나지 않는 것이 특징이 되겠습니다.','segment-4-0'),
 L(163,166,'일이 되겠습니다.','coverage-152-6')
],202);
assert.equal(clippedEnding.lines.length,1,'short one-syllable tail echo removed without inventing content');
// A speaker can genuinely repeat complete thoughts; don't remove across time.
const far=finalizeSpeechTimeline([L(25,31,'혈관도 청소가 필요합니다.','segment-0-0'),L(180,185,'혈관도 청소가 필요합니다.','segment-5-0')],202);
assert.equal(far.lines.length,2);
// Similar medical comparisons must not be treated as repeated speech.
const topics=finalizeSpeechTimeline([L(132,137,'허리의 디스크 탈출증 때문에 다리가 아플 수 있습니다.'),L(139,146,'동맥의 혈관 폐색 때문에 다리가 아플 수 있습니다.')],202);
assert.equal(topics.lines.length,2);
// A full sentence at an earlier time is not automatically removed by a later phrase.
const real=finalizeSpeechTimeline([L(40,45,'다리의 혈관 상태를 관리해야 합니다.','segment-0-0'),L(80,85,'다리의 혈관 상태를 관리해야 합니다.','segment-2-0')],202);
assert.equal(real.lines.length,2);
console.log('PASS v4.8: 00:30 trailing echo; 02:15 early misplaced ending; 02:45 genuine full ending; no invented 02:11 text; close farewell and distinct medical contrasts');
