import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file){const input=fs.readFileSync(path.join(root,file),'utf8');const output=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(output.diagnostics?.length??0,0);const exports={};Function('exports','require','module',output.outputText)(exports,()=>{throw Error('unexpected runtime dependency')},{exports});return exports;}
const {speechReviewWindows,speechFirstTimeline,mergeSupplementalSpeech}=load('lib/speech-timeline.ts');
const duration=202;
const lines=[
 {id:'s0',startSeconds:0,endSeconds:9,text:'흔히 동맥경화라고 하면 심장이나 뇌혈관 질환을 먼저 떠올립니다.',translated:false},
 {id:'s1',startSeconds:13,endSeconds:20,text:'심장에서 발끝까지 피를 보내는 통로가 바로 하지동맥입니다.',translated:false},
 {id:'s2',startSeconds:59,endSeconds:63,text:'갑자기 혈전이나 색전으로 막히는 경우도 있고요.',translated:false},
 {id:'s3',startSeconds:117,endSeconds:125,text:'저희 환자 중에도 20대인데 헬스클럽 트레이너인 분이 있습니다.',translated:false},
 {id:'s4',startSeconds:132,endSeconds:140,text:'또 30대인 분들도 많이 오시는데요.',translated:false},
 ];
const gaps=speechReviewWindows(lines,duration);
assert.ok(gaps.some(x=>x.from===140&&x.to===202),'must request missing 62-second tail');
assert.ok(gaps.some(x=>x.from===63&&x.to===117),'must detect central missing speech');
const original=[{id:'e0',startSeconds:0,endSeconds:200,kind:'video',note:'요약 메모'}];
const built=speechFirstTimeline(lines,original,duration);
assert.equal(built.timeline.length,5);
assert.deepEqual(built.timeline.map(x=>x.text),lines.map(x=>x.text),'never replace spoken sentences with third-party editorial summary');
assert.equal(built.timeline[0].title,'');
assert.equal(built.evidence.length,6);
assert.equal(built.lastEnd,140);
const supplement={lines:[{startSeconds:157,endSeconds:168,text:'허리를 굽히면 증상이 호전되는 경우가 있고요.'},{startSeconds:183,endSeconds:199,text:'다리가 보내는 신호를 무시하지 마시고 혈관을 점검해 보세요.'},{startSeconds:205,endSeconds:207,text:'영상에 없는 가짜 발언'},{startSeconds:157,endSeconds:168,text:'허리를 굽히면 증상이 호전되는 경우가 있고요.'}]};
const merged=mergeSupplementalSpeech(lines,supplement,duration);
assert.equal(merged.added,2);
assert.equal(speechReviewWindows(merged.lines,duration).some(g=>g.to===202),false);
const sparseFull=[{id:'a',startSeconds:0,endSeconds:100,text:'첫 번째 발언을 듣고 있습니다.',translated:false},{id:'b',startSeconds:100,endSeconds:202,text:'마지막 발언을 듣고 있습니다.',translated:false}];
assert.deepEqual(speechReviewWindows(sparseFull,duration),[{from:0,to:202}],'long but sparse script must trigger optional full speech verification');
const after=speechFirstTimeline(merged.lines,original,duration);
assert.equal(after.timeline.at(-1).text,'다리가 보내는 신호를 무시하지 마시고 혈관을 점검해 보세요.');
const ai=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
assert.match(ai,/speechFirstTimeline/);
assert.match(ai,/speech-tail/);
assert.match(ai,/speechFirstTimeline/);
console.log('PASS: exact model utterance preservation; middle and tail gap detection; supplemental speech validation; no fabricated video-end times');
