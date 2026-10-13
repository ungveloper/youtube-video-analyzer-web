import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file,dependencies={}){
  const input=fs.readFileSync(path.join(root,file),'utf8');
  const result=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics?.length??0,0,`transpile: ${file}`);
  const exports={};
  Function('exports','require','module',result.outputText)(exports,(id)=>{
    if(!(id in dependencies))throw Error('Unexpected import: '+id);
    return dependencies[id];
  },{exports});
  return exports;
}
const {parseTimedCaptions}=load('lib/caption-input.ts');
const {sourceFromUserCaptions,timelineFromProvidedCaptions}=load('lib/server/caption-source.ts',{'@/lib/caption-input':{parseTimedCaptions}});
const duration=202;
const raw=`[0:00] 흔히 동맥경화라고 하면 심장이나 뇌혈관 질환을 먼저 떠올립니다.
[0:04] 하지만 이 질병의 80%가 다리에서 시작됩니다.
[0:13] 심장에서 발끝까지 피를 보내는 통로, 그게 바로 하지동맥입니다.
[1:44] 담배를 많이 피우시는 분들한테 생기는 혈관염이 있고요.
[2:34] 그래서 걷거나 운동할 때 주로 종아리, 허벅지, 엉덩이에도 발생할 수 있는데요.
[2:58] 이상 신호가 있으면 혈관 상태를 점검해야 합니다.`;
const cues=parseTimedCaptions(raw,duration);
assert.deepEqual(cues.map(c=>c.startSeconds),[0,4,13,104,154,178]);
assert.equal(cues.at(-1).endSeconds,178,'unknown final cue end must not be set to 03:22');
const video={id:'12345678901',title:'vascular',channel:'hospital',thumbnail:'',durationSeconds:duration,url:'https://www.youtube.com/watch?v=12345678901'};
const source=sourceFromUserCaptions(raw,video);
const timeline=timelineFromProvidedCaptions(source);
assert.deepEqual(timeline.map(x=>x.text),source.evidence.map(x=>x.note),'timeline must keep captions without AI paraphrase');
assert.equal(timeline.some(x=>/뇌경색 위험의 80%/.test(x.text)),false,'cannot manufacture or alter the claim from source');
assert.ok(timeline.some(x=>x.text.includes('하지만 이 질병의 80%가 다리에서 시작됩니다.')));
assert.ok(timeline.every(x=>!x.title));
assert.deepEqual(timeline.map(x=>source.evidence.find(e=>e.id===x.evidenceIds[0])?.startSeconds),source.evidence.map(e=>e.startSeconds));
assert.equal(source.transcript.length,cues.length);
assert.equal(source.transcript[2].text,cues[2].text);
const {assessTimelineTiming}=load('lib/timeline-accuracy.ts');
const longLast=[{id:'ev',startSeconds:168,endSeconds:198,kind:'audio',note:'마지막 설명을 이어서 말합니다.'}];
const closing=assessTimelineTiming([{id:'t',text:'원문 그대로의 마지막 발화',evidenceIds:['ev']}],longLast,202);
assert.equal(closing.lastStartSeconds,168);
assert.equal(closing.lastEndSeconds,198);
assert.equal(closing.hasSparseEnding,false,'early start does not imply missing final speech');
const unknown=assessTimelineTiming(timeline,source.evidence,202);
assert.equal(unknown.lastEndSeconds,178,'pasted transcript provides no later end anchor');
assert.equal(unknown.hasSparseEnding,true);
const ai=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
assert.match(ai,/provided\s*\? timelineFromProvidedCaptions\(source\)/);
const ui=fs.readFileSync(path.join(root,'components/analysis-workspace.tsx'),'utf8');
assert.match(ui,/마지막 시간 근거 종료/);
console.log('PASS: bracketed timestamps; verbatim caption timeline; original claims unchanged; unknown final end not invented; last end controls review');
