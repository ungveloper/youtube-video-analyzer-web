import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const modules=new Map();
function load(p){
 if(modules.has(p))return modules.get(p);
 const result=ts.transpileModule(read(p),{fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(result.diagnostics?.length||0,0);
 const exports={};modules.set(p,exports);
 Function('exports','require',result.outputText)(exports,name=>{
  if(name==='./segmented-speech')return load('lib/segmented-speech.ts');
  if(name==='./speech-timeline')return load('lib/speech-timeline.ts');
  if(name==='./types'||name==='./server/evidence-pipeline')return {};
  throw Error('Unexpected import '+name);
 });return exports;
}
const {precisionSpeechSegments,shortSpeechSegments,parseSegmentedSpeech}=load('lib/segmented-speech.ts');
const {makeSpeechClipRequest,collectSpeechClipResults}=load('lib/speech-clip-pipeline.ts');
const clips=precisionSpeechSegments(202,'static');
assert.equal(clips.length,6,'202 seconds => 6 short audio windows');
assert.deepEqual(clips.map(c=>[c.coreFrom,c.coreTo]),[[0,34],[34,67],[67,101],[101,135],[135,168],[168,202]]);
assert.deepEqual(clips.map(c=>[c.from,c.to]),[[0,38],[30,71],[63,105],[97,139],[131,172],[164,202]]);
assert(clips.every(c=>c.to-c.from<=45));
assert.deepEqual(precisionSpeechSegments(300,'static').map(s=>s.index),[0,1,2,3,4,5,6,7]);
assert.equal(precisionSpeechSegments(202,'agentic').length,0);
assert.equal(precisionSpeechSegments(301,'static').length,0);
assert.deepEqual(shortSpeechSegments(202,'static').map(x=>[x.from,x.to]),[[0,67],[67,135],[135,202]],'Legacy standalone video route stays unchanged');
for(const clip of clips){
 const request=makeSpeechClipRequest('https://www.youtube.com/watch?v=aFmUl65-2-c',clip);
 assert.equal(request[0].processing.start_offset,clip.from+'s');
 assert.equal(request[0].processing.end_offset,clip.to+'s');
 assert.equal(request[0].name,undefined);
 assert.match(request[1].text,/상대시간/);
 assert.match(request[1].text,new RegExp('원본 '+clip.coreFrom+'초 이상'));
}
const transcript=clips.map(clip=>({segment:clip,parsed:{lines:[
 {startSeconds:clip.coreFrom-clip.from+2,endSeconds:clip.coreFrom-clip.from+5,text:`${clip.index}번 구간 첫 번째 실제 음성 발언입니다.`},
 {startSeconds:clip.coreTo-clip.from+1,endSeconds:Math.min(clip.to-clip.from,clip.coreTo-clip.from+3),text:`${clip.index}번 문맥 영역의 중복 음성 발언입니다.`},
]}}));
const parsed=collectSpeechClipResults(transcript,clips);
assert.equal(parsed.coveredSegments.length,6);
assert.deepEqual(parsed.lines.map(l=>l.startSeconds),[2,36,69,103,137,170]);
assert(parsed.rejected>=5,'Context-only speech belongs to another core and must be rejected');
const onlyPrev=collectSpeechClipResults([{segment:clips[0],parsed:{lines:[{startSeconds:32,endSeconds:35,text:'이전 구간 말미에 등장한 실제 발언입니다.'}]}}],clips);
assert(onlyPrev.coveredSegments.includes(0));
assert(onlyPrev.failedSegments.includes(1),'Neighbor core MUST NOT be considered covered by an overlapping window');
const safe=parseSegmentedSpeech({segmentTranscripts:[{segmentIndex:3,lines:[
 {startSeconds:3,endSeconds:6,text:'코어 범위 이전에 있는 문장입니다.'},
 {startSeconds:7,endSeconds:10,text:'정확한 코어 시작에 속하는 발언입니다.'},
 {startSeconds:40,endSeconds:42,text:'이 문장은 클립 범위 밖에 있습니다.'},
]}]},clips);
assert.deepEqual(safe.lines.map(l=>l.text),['정확한 코어 시작에 속하는 발언입니다.']);
const ai=read('lib/server/ai.ts');
assert.match(ai,/const ordered=\[segments\.at\(-1\)!,\.\.\.segments\.slice\(0,-1\)\]/);
assert.match(ai,/for\(let offset=1;offset<ordered\.length;offset\+=2\)/);
assert.match(ai,/if\(rest\.some\(outcome=>outcome\.failure==='FREE_LIMIT'\)\)break/);
assert.match(ai,/const speechDeadline=started\+205000/);
assert.match(ai,/const finalDeadline=started\+265000/);
assert.match(ai,/model:activeModel,requestId,pass:'speech-compose'/);
console.log('PASS: six 38-44s overlapping clips, owned utterance starts, no invented time, failure/429 and total duration bounded');
