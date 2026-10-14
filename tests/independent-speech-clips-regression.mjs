import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const cache=new Map();
function load(relative){
 if(cache.has(relative))return cache.get(relative);
 const code=ts.transpileModule(read(relative),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(code.diagnostics?.length??0,0);
 const exports={};cache.set(relative,exports);
 Function('exports','require',code.outputText)(exports,req=>{
  if(req==='./segmented-speech')return load('lib/segmented-speech.ts');
  if(req==='./speech-timeline')return load('lib/speech-timeline.ts');
  if(req==='./types'||req==='./server/evidence-pipeline')return {};
  throw Error(`Unexpected import ${req}`);
 });return exports;
}
const {shortSpeechSegments}=load('lib/segmented-speech.ts');
const {makeSpeechClipRequest,collectSpeechClipResults,speechSource,formatMissingWindows}=load('lib/speech-clip-pipeline.ts');
const segments=shortSpeechSegments(202,'static');
assert.deepEqual(segments.map(x=>[x.from,x.to]),[[0,67],[67,135],[135,202]]);
const req=makeSpeechClipRequest('https://www.youtube.com/watch?v=aFmUl65-2-c',segments[2]);
assert.equal(req[0].processing.start_offset,'135s');assert.equal(req[0].processing.end_offset,'202s');
assert.equal(req[0].name,undefined);assert.equal(req[0].display_name,undefined);
const results=[
 {segment:segments[2],parsed:{lines:[{startSeconds:4,endSeconds:11,text:'영상 후반에만 있는 구체적인 마지막 발언입니다.'},{startSeconds:60,endSeconds:66,text:'여러분 모두 건강하시고 감사합니다.'}]}},
 {segment:segments[0],parsed:{lines:[{startSeconds:0,endSeconds:4,text:'도입에서 실제로 말하는 음성입니다.'},{startSeconds:55,endSeconds:65,text:'다리 혈관에 관한 설명입니다.'}]}},
 {segment:segments[1],parsed:{lines:[{startSeconds:5,endSeconds:11,text:'1분 이후 계속 이어지는 발언입니다.'},{startSeconds:52,endSeconds:59,text:'2분 이후에 진행되는 추가 발언입니다.'},{startSeconds:2,endSeconds:3,text:'1초에 다 담을 수 없는 아주 많은 양의 텍스트를 여기에 욱여넣으면 비정상적인 시간 정보가 되므로 반드시 차단해야 하며 그래야만 제대로 된 테스트가 가능합니다.'}]}}
];
const merged=collectSpeechClipResults(results,segments);
assert(merged.lines.some(l=>l.startSeconds===139 && l.text.includes('후반')));
assert(merged.lines.some(l=>l.startSeconds===195 && l.text.includes('감사합니다')));
assert(merged.lines.some(l=>l.startSeconds===72 && l.text.includes('1분 이후')));
assert.equal(merged.failedSegments.length,0);
assert(merged.rejected>=1);
const source=speechSource(merged.lines,202);
assert.equal(source.claims.length,merged.lines.length);
assert(source.evidence.every(e=>e.kind==='audio'));
assert.equal(formatMissingWindows([{from:159,to:202}]),'02:39~03:22');
const incomplete=collectSpeechClipResults([{segment:segments[0],parsed:{lines:[{startSeconds:0,endSeconds:4,text:'시작 발언입니다.'}]}},{segment:segments[1],failure:'FREE_LIMIT'}],segments);
assert(incomplete.failedSegments.includes(2));
assert(incomplete.missingWindows.some(w=>w.to===202));
const ui=read('components/analysis-workspace.tsx');
const form=read('components/video-form.tsx');
const ai=read('lib/server/ai.ts');
assert.match(form,/router\.push\(`\/analyze\/\$\{id\}\?start=1`\)/);
assert.match(ui,/autoStarted\.current=true/);
assert.match(ui,/autoSpeech:true/);
assert.match(ai,/mode:'speech-focused'/);
assert.match(ai,/sourceMode:'video-url'/);
assert.match(ai,/pass:`speech-clip-\$\{segment\.index\}`/);
console.log('PASS: immediate home-to-analysis; three separate actual static clips; relative-to-global time; late video transcript and explicit missing windows; no invented silence');
