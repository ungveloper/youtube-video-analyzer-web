import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const load = path => {
  const code=fs.readFileSync(path,'utf8');
  const compiled=ts.transpileModule(code,{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(compiled.diagnostics?.length??0,0,path);
  const exported={};Function('exports',compiled.outputText)(exported);
  return exported;
};
const {finalizeSpeechTimeline}=load('lib/speech-finalize.ts');
const {mergeSpeechSentences}=load('lib/speech-sentence-merge.ts');
const line=(s,e,text,id=`segment-5-${s}`)=>({id,startSeconds:s,endSeconds:e,text,translated:false});

// These examples are REGRESSION FIXTURES, never injected into the video output.
// Exactly the collision patterns reported after the 202-second analysis.
const reported=[
 line(126,131,'이런 같은 현상이 반복되는 것이 특징입니다.','segment-3-4'),
 line(133,135,'많은 환자분들이 허리 질환, 특히 젊은 사람들은 디스크, 탈출증,','coverage-119-3'),
 line(135,141,'하지만 이런 허리에 의한 질환과 동맥의 폐색에 의한 질환은 엄격하게 구분이 되지요.','segment-4-0'),
 line(140,147,'마트에서 허리를 굽혀 카트에 몸을 기대어서 걸으시면','coverage-119-4'),
 line(144,150,'척추관 협착증 환자들은 어느 정도 증상이 호전되는데요.','segment-4-3'),
 line(148,153,'동맥 환자들은 자세와 관계없이 통증이 발생합니다.','segment-4-4'),
 line(150,155,'그리고 다리의 온도도 비교가 됩니다.','segment-4-5'),
 line(153,158,'다리도 약간 창백하게 보이고요. 만져보면은 차갑게 느껴지는 것이 특징이고 어떤 경우는 털도 나지 않는 것이 특징이 되겠습니다.','segment-4-6'),
 line(158,161,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의','segment-4-7'),
 line(167,172,'이렇듯 일상생활에서 쉽게 체크할 수 있으니','coverage-119-9'),
 line(168,179,'이렇든 일상생활에서 손쉽게 체크할 수 있으니 여러분의 다리에 이런 신호가 온다면 이건 단순한 피로에 의한 것이 아니에요.','coverage-160-0'),
 line(173,178,'몸에 보내는 경고등이기도 합니다.','segment-5-0'),
 line(179,184,'우리 몸속에 있는 혈관 상수도도 한번 점검해 보는 시간을 가져보시길 바랍니다.','segment-5-1'),
 line(180,183,'혈관도 청소가 필요합니다.','segment-5-2'),
 line(182,190,'청맥병원 변승재 원장입니다. 감사합니다.','coverage-164-4'),
 line(188,193,'정맥병원 변승재 원장입니다.','segment-5-5'),
];
const out=finalizeSpeechTimeline(reported,202);
const phrases=out.lines.map(x=>x.text);
assert.equal(phrases.filter(x=>x.startsWith('이렇듯 일상생활에서')||x.startsWith('이렇든 일상생활에서')).length,1,'02:38/02:47/02:48 are 3 variants of ONE passage');
const full=out.lines.find(x=>x.text.includes('이건 단순한 피로에 의한 것이 아니에요'));
assert(full,'retain the COMPLETE version of the repeated passage');
assert.equal(full.startSeconds,168,'do not assign the 02:38 fragment timestamp to a sentence really heard at 02:48');
assert.equal(phrases.filter(x=>x.includes('변승재 원장입니다')).length,1,'03:02/03:08 overlapping goodbye is not two different speakers');
assert(phrases.some(x=>x.includes('감사합니다.')),'keep actual thank-you instead of shorter fragment');
assert(phrases.some(x=>x.includes('디스크, 탈출증')),'do not silently erase the only surviving young-patient description');
assert(phrases.some(x=>x.startsWith('하지만 이런 허리에')),'keep distinct contrast statement');
assert(phrases.some(x=>x.includes('카트에 몸을')),'preserve separate cart example');
assert(phrases.some(x=>x.includes('동맥 환자들은')),'preserve symptom contrast');

const guard=mergeSpeechSentences([
 line(133,135,'많은 환자분들이 허리 질환, 특히 젊은 사람들은 디스크, 탈출증,','segment-4-0'),
 line(135,140,'하지만 이런 허리 질환은 서로 구분해야 합니다.','segment-4-1'),
],202);
assert.equal(guard.length,2,'a new contrasting clause cannot be attached to an unfinished list');
const repeated=mergeSpeechSentences([
 line(158,161,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의','segment-4-0'),
 line(168,180,'이렇듯 일상생활에서 손쉽게 체크할 수 있으니 여러분의 다리에 이런 신호가 온다면 단순한 피로가 아닙니다.','coverage-160-0'),
],202);
assert.equal(repeated.length,2,'a later complete quote must not inherit the earlier fragment timestamp');
const realRepeat=finalizeSpeechTimeline([
 line(20,25,'혈관 상태를 꼭 확인해 보시길 바랍니다.','segment-0-1'),
 line(180,185,'혈관 상태를 꼭 확인해 보시길 바랍니다.','segment-5-1'),
],202);
assert.equal(realRepeat.lines.length,2,'far-apart genuine repeated spoken advice is not collapsed');
const distinct=finalizeSpeechTimeline([
 line(140,145,'혈관 질환에 대해서 설명하겠습니다.','coverage-131-2'),
 line(141,146,'허리 질환에 대해서 설명하겠습니다.','segment-4-2'),
],202);
assert.equal(distinct.lines.length,2,'same-topic but opposite medical conditions are different utterances');
assert(!fs.readFileSync('lib/speech-finalize.ts','utf8').includes('변승재'), 'no video-specific words in production');
console.log('PASS v4.7: three overlapping end clauses -> one; complete goodbye preserved; contrast not mixed; distinct speech protected');
