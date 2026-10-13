import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=fs.readFileSync(path.join(root,'lib/segmented-speech.ts'),'utf8');
const output=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(output.diagnostics?.length??0,0);
const compiled={exports:{}};
Function('exports','require','module',output.outputText)(compiled.exports,()=>{throw Error('unexpected import');},compiled);
const {shortSpeechSegments,clipProcessing,clipVideoInputs,parseSegmentedSpeech}=compiled.exports;
const parts=shortSpeechSegments(202,'static');
assert.deepEqual(parts,[{index:0,from:0,to:67},{index:1,from:67,to:135},{index:2,from:135,to:202}]);
assert.deepEqual(clipProcessing(parts[1]),{type:'static',start_offset:'67s',end_offset:'135s'});
const apiInputs=clipVideoInputs('https://www.youtube.com/watch?v=aFmUl65-2-c',parts);
assert.deepEqual(apiInputs.map(x=>Object.keys(x)),[
 ['type','uri','processing'],['type','uri','processing'],['type','uri','processing']
],'static clip videos must NOT expose display_name/name');
assert.deepEqual(apiInputs.map(x=>x.processing),[
 {type:'static',start_offset:'0s',end_offset:'67s'},
 {type:'static',start_offset:'67s',end_offset:'135s'},
 {type:'static',start_offset:'135s',end_offset:'202s'}
]);
assert.ok(!/\"(?:display_name|name)\"\s*:/.test(JSON.stringify(apiInputs)),'static media payload must never contain display_name/name');
assert.deepEqual(shortSpeechSegments(202,'agentic'),[]);
assert.deepEqual(shortSpeechSegments(800,'static'),[]);
const result=parseSegmentedSpeech({segmentTranscripts:[
 {segmentIndex:0,lines:[{startSeconds:0,endSeconds:4,text:'먼저 심장에서 다리로 혈액을 보냅니다.'}]},
 {segmentIndex:1,lines:[{startSeconds:1,endSeconds:5,text:'담배를 피우는 경우 혈관에 문제가 생기기도 합니다.'},{startSeconds:2,endSeconds:5,text:'담배를 피우는 경우 혈관에 문제가 생기기도 합니다.'},{startSeconds:102,endSeconds:105,text:'미래 내용은 현재 클립에 없습니다.'}]},
 {segmentIndex:2,lines:[{startSeconds:24,endSeconds:31,text:'간헐적 파행이 나타나는 증상을 살펴보겠습니다.'},{startSeconds:51,endSeconds:60,text:'혈관 검진을 받을 필요가 있겠습니다.'}]}
]},parts);
assert.deepEqual(result.missingSegments,[]);
assert.deepEqual(result.lines.map(x=>x.startSeconds),[0,68,159,186]);
assert.ok(result.rejected>=2,'reject local out-of-range and exact duplicated speech');
assert.equal(result.lines.at(-1).endSeconds,195);
const missing=parseSegmentedSpeech({segmentTranscripts:[{segmentIndex:0,lines:[{startSeconds:2,endSeconds:5,text:'혈액이 다리로 이동합니다.'}]}]},parts);
assert.deepEqual(missing.missingSegments,[1,2]);
const invalid=parseSegmentedSpeech({segmentTranscripts:[{segmentIndex:2,lines:[{startSeconds:1,endSeconds:1.1,text:'한순간에 너무나도 길고 긴 문장을 아무 이유도 없이 백 글자 이상 한꺼번에 우겨넣어서 나올 수 없도록 무조건 거절되어야 하는 발언 사례를 만들었습니다. 이런 발언이 아주 짧게 들어갔다고 믿으면 안 됩니다.'}]}]},parts);
assert.equal(invalid.lines.length,0);
const ai=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
assert.match(ai,/segmentShortSpeech\?shortSpeechSegments\(video\.durationSeconds,videoProcessing\):\[\]/);
assert.match(ai,/segmentTranscripts/);
assert.match(ai,/clipVideoInputs\(video\.url,segments\)/);
assert.doesNotMatch(ai,/name:\s*`speech-segment/,'regression: static video content named in the outgoing request');
assert.match(ai,/result\.original\.transcript=segmented\.lines/);
assert.match(ai,/start_offset:`\$\{Math\.floor\(recoveryWindow\[0\]\.from\)\}s`/);
assert.match(ai,/missingSpeechWindows:unresolved/);
const route=fs.readFileSync(path.join(root,'app/api/analyze/route.ts'),'utf8');
const ui=fs.readFileSync(path.join(root,'components/analysis-workspace.tsx'),'utf8');
assert.match(route,/body\.segmentShortSpeech===undefined \? false/);
assert.match(route,/recoverMissingSpeech, segmentShortSpeech\)/);
assert.match(ui,/segmentShortSpeech,captionText/);
assert.match(ui,/setSegmentShortSpeech/);
assert.match(ai,/const response=await interaction\(\{key,model,requestId,pass:segments\.length\?'standard-segmented':'standard'/);
console.log('PASS: STATIC media request without display_name/name; 3 static clips in one request, provider-relative to global seconds, wrong offsets/duplicates rejected, missing tail stays partial');
