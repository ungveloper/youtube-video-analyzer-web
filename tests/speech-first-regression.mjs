import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file){const input=fs.readFileSync(path.join(root,file),'utf8');const output=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(output.diagnostics?.length??0,0);const exports={};Function('exports','require','module',output.outputText)(exports,()=>{throw Error('unexpected runtime dependency')},{exports});return exports;}
const {speechReviewWindows,chooseSpeechRecoveryWindow,speechFirstTimeline,mergeSupplementalSpeech,dedupeInitialSpeech}=load('lib/speech-timeline.ts');
const duration=202;
const lines=[
 {id:'s0',startSeconds:0,endSeconds:4,text:'흔히 동맥경화라고 하면 심장이나 뇌혈관 질환을 먼저 떠올립니다.',translated:false},
 {id:'s1',startSeconds:4,endSeconds:9,text:'하지만 이 질병의 80%가 다리에서 시작됩니다.',translated:false},
 {id:'s2',startSeconds:13,endSeconds:20,text:'심장에서 발끝까지 피를 보내는 통로가 바로 하지동맥입니다.',translated:false},
 {id:'s3',startSeconds:59,endSeconds:63,text:'갑자기 혈전이나 색전으로 막히는 경우도 있고요.',translated:false},
 {id:'s4',startSeconds:117,endSeconds:125,text:'저희 환자 중에도 20대인데 헬스클럽 트레이너인 분이 있습니다.',translated:false},
 {id:'s5',startSeconds:132,endSeconds:140,text:'또 30대인 분들도 많이 오시는데요.',translated:false},
];
const gaps=speechReviewWindows(lines,duration);
assert.ok(gaps.some(x=>x.from===140&&x.to===202),'detect 62-second ending without voice');
assert.ok(gaps.some(x=>x.from===63&&x.to===117),'detect middle gap');
assert.deepEqual(chooseSpeechRecoveryWindow(gaps,duration),[{from:140,to:202}], 'prioritize missing final section instead of requesting multiple windows');
assert.deepEqual(chooseSpeechRecoveryWindow([{from:0,to:202}],duration),[{from:101,to:202}], 'unknown whole-video transcript should be restricted to the latter half');
const repeated={...lines[0],id:'duplicate',startSeconds:1,endSeconds:5};
assert.equal(dedupeInitialSpeech([...lines,repeated],duration).length,lines.length);
const original=[{id:'e0',startSeconds:0,endSeconds:200,kind:'video',note:'요약 메모'}];
const built=speechFirstTimeline(lines,original,duration);
assert.deepEqual(built.timeline.map(x=>x.text),lines.map(x=>x.text),'never rewrite already obtained transcript into summaries');
assert.equal(built.timeline[0].title,'');
assert.equal(built.lastEnd,140);
const requested=[{from:140,to:202}];
// Recreate the user's v22 failure: late-video utterances incorrectly labeled as
// 00:02, including an initial duplicate and multi-sentence medical discussion.
const bad={lines:[
 {startSeconds:1,endSeconds:4,text:lines[0].text},
 {startSeconds:2,endSeconds:4,text:'많은 환자분들이 허리 질환 특히 젊은 사람들은 디스크 탈출증 그다음에 나이 드신 분들은 척추관 협착증 같은 허리 질환으로 많이 혼동되곤 합니다.'},
 {startSeconds:2,endSeconds:3,text:'마트에서 허리를 굽혀 카트에 몸을 기대서 걸으시면 척추관 협착증 환자들은 어느 정도 증상이 호전되는데요.'},
 {startSeconds:3,endSeconds:4,text:'혈관도 청소가 필요합니다. 우리 몸속에 있는 혈관 상수도도 한번 점검해 보시길 바랍니다.'},
]};
const rejected=mergeSupplementalSpeech(lines,bad,duration,requested);
assert.equal(rejected.added,0,'v22 [00:02] corruption must not recur');
assert.equal(rejected.rejectedOutOfWindow,4);
assert.deepEqual(rejected.lines,lines);
const supplement={lines:[
 {startSeconds:160,endSeconds:169,text:'허리를 굽히면 증상이 호전되는 경우가 있고요.'},
 {startSeconds:184,endSeconds:199,text:'다리가 보내는 신호를 무시하지 마시고 혈관을 점검해 보세요.'},
 {startSeconds:205,endSeconds:207,text:'영상에 없는 가짜 발언입니다.'},
 {startSeconds:160,endSeconds:169,text:'허리를 굽히면 증상이 호전되는 경우가 있고요.'},
 {startSeconds:171,endSeconds:172,text:'이렇게 아주 길고 구체적인 의학적 설명을 한꺼번에 담을 수 없는 단 일 초 구간으로 말했습니다. 하지만 이건 믿을 수 없어요.'},
 {startSeconds:160,endSeconds:169,text:lines[0].text},
 {startSeconds:139,endSeconds:146,text:'요청한 시간 밖에서 시작된 문장입니다.'},
]};
const merged=mergeSupplementalSpeech(lines,supplement,duration,requested);
assert.equal(merged.added,2,'only valid, nonoverlapping, nonduplicate tail utterances accepted');
assert.ok(merged.rejected>=5);
assert.equal(merged.rejectedOutOfWindow,1);
assert.deepEqual(merged.lines.slice(-2).map(x=>x.startSeconds),[160,184]);
assert.equal(speechReviewWindows(merged.lines,duration).some(g=>g.to===202),false);
const noWindow=mergeSupplementalSpeech(lines,supplement,duration,[]);
assert.equal(noWindow.added,0,'never accept unscoped supplemental timecodes');
const ai=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
assert.match(ai,/chooseSpeechRecoveryWindow\(initialGaps/);
assert.match(ai,/mergeSupplementalSpeech\(result\.original\.transcript,supplement\.parsed,video\.durationSeconds,recoveryWindow\)/);
assert.match(ai,/rejectedOutOfWindow/);
assert.match(ai,/dedupeInitialSpeech/);
assert.match(ai,/result\.analysisMeta=\{depth:'standard'/);
console.log('PASS: reject 00:02 hallucinated tail, full-window leakage, timeline duplicates, temporal overlaps and 1-second paragraph; preserve original speech and signal incomplete tail');
