import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const read=(p)=>fs.readFileSync(p,'utf8');
const compiled=ts.transpileModule(read('lib/speech-finalize.ts'),{fileName:'lib/speech-finalize.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length??0,0);
const exportsForTest={};Function('exports',compiled.outputText)(exportsForTest);
const {finalizeSpeechTimeline}=exportsForTest;
const row=(s,e,t,id=`segment-${s}`)=>({startSeconds:s,endSeconds:e,text:t,id,translated:false});
// Case from actual user-provided 202s comparison, as FIXTURES only.
const lines=[
 row(80,85,'저희 환자 중에도 20대인데요. 헬스 트레이너인 분이 있습니다.'),
 row(81,85,'헬스 클럽 트레이너인 분이 있습니다.','coverage-81'),
 row(82,84,'그런데 다리가 아파서 오셨는데요.'),
 row(85,93,'그런데 다리가 아파서 오셨는데요. 이분은 무릎 뒤의 근육이 발달하여 슬와동맥을 누른 경우입니다.','coverage-85'),
 row(108,113,'말초 동맥의 폐색에 의해서 나타나는 대표적인 증상이 간헐적 파행이에요.'),
 row(112,114,'간헐적 파행이에요.'),
 row(113,118,'그래서 걷거나 운동할 때 주로 종아리, 허벅지, 엉덩이에도 발생할 수 있는데요.'),
 row(118,124,'대부분 어느 정도 걷거나 운동하다 보면 아파서 쉬어야 되고요.'),
 row(121,124,'아파서 쉬어야 되고요.'),
 row(128,135,'많은 환자분들이 허리 질환 특히 젊은 사람들은 대부분 어느 정도 걷거나 운동하다 보면 그리고 다리의 온도도 비교가 됩니다.'),
 row(132,137,'디스크 탈출증, 나이 드신 분들은 척추관 협착증 같은 허리 질환으로 많이 혼동되곤 합니다.'),
 row(138,144,'하지만 이런 허리에 의한 질환과 동맥 폐색에 의한 질환은 엄격하게 구분이 되지요.'),
 row(144,148,'마트에서 허리를 굽혀 카트에 몸을 기대서 걸으시면'),
 row(148,151,'척추관 협착증 환자들은 어느 정도 증상이 호전되는데요.'),
 row(151,155,'동맥 환자들은 자세와 관계없이 통증이 발생합니다.'),
 row(135,139,'그리고 다리의 온도도 비교가 됩니다.'),
 row(155,159,'그리고 다리의 온도도 비교가 됩니다.','coverage-155'),
 row(158,164,'다리도 약간 창백하게 보이고요. 만져보면 차갑게 느껴지는 것이 특징입니다.','coverage-158'),
 row(138,144,'다리도 약간 창백하게 보이고요. 만져보면 차갑게 느껴지는 것이 특징입니다.'),
 row(148,152,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의'),
 row(168,174,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의 다리에 이런 신호가 온다면 이것은 단순한 피로가 아닙니다.','coverage-168'),
];
const result=finalizeSpeechTimeline(lines,202);
const texts=result.lines.map(l=>l.text);
assert(!texts.some(t=>t.includes('젊은 사람들은 대부분 어느 정도 걷거나 운동하다 보면 그리고')),'Mixed clauses from distant video positions must not appear');
assert.equal(texts.filter(t=>t.includes('간헐적 파행이에요')).length,1);
assert.equal(texts.filter(t=>t.startsWith('그런데 다리가 아파서 오셨는데요.')).length,1);
assert.equal(texts.filter(t=>t.includes('트레이너인 분이 있습니다.')).length,1,'Do not duplicate a patient/trainer statement with a short spelling variation');
assert.equal(texts.filter(t=>t.startsWith('아파서 쉬어야 되고요.')).length,0);
assert.equal(texts.filter(t=>t.includes('그리고 다리의 온도도 비교가 됩니다.')).length,1);
assert.equal(texts.filter(t=>t.startsWith('이렇듯 일상생활에서 손쉽게 체크할 수 있으니')).length,1);
assert(texts.some(t=>t.includes('척추관 협착증 같은 허리 질환')),'Preserve genuinely distinct comparison content');
assert(texts.some(t=>t.includes('카트에 몸을 기대서')),'Preserve the cart example');
assert(texts.some(t=>t.includes('종아리, 허벅지, 엉덩이')),'Preserve intermittent claudication symptoms');
assert(result.duplicatesRemoved>=5);
assert.equal(result.collagesQuarantined,1);
const distinct=finalizeSpeechTimeline([row(20,26,'다리 혈관에 이상이 발생할 수 있습니다.'),row(22,27,'혈류가 감소하면 통증이 생길 수 있습니다.')],202);
assert.equal(distinct.lines.length,2,'Never suppress different phrases purely for overlapping timestamps');
assert.equal(distinct.unverifiedTimeCollisions,1);
const repeat=finalizeSpeechTimeline([row(12,17,'혈관도 청소가 필요합니다.'),row(181,184,'혈관도 청소가 필요합니다.')],202);
assert.equal(repeat.lines.length,2,'Repeated real phrase far apart is not a duplicate');
const ai=read('lib/server/ai.ts');
assert.match(ai,/finalizeSpeechTimeline\(finalLines,video\.durationSeconds\)/);
assert.match(ai,/event:'analysis\.speech_final_reconcile'/);
console.log('PASS: sentence-level dedup, preserve distinct overlapping audio, quarantine cross-time quote collage, keep genuine repeated speech');
