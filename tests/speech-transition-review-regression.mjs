import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('lib/speech-coverage-recovery.ts','utf8');
const transpiled=ts.transpileModule(source,{fileName:'lib/speech-coverage-recovery.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(transpiled.diagnostics?.length??0,0,'TypeScript syntax diagnostics');
const exported={};
Function('exports',transpiled.outputText)(exported);
const {planSpeechRepairWindows,planSpeechCoverageWindows,makeSpeechCoverageRequest,extractCoverageReviewRows,mergeIndependentCoverage}=exported;
const row=(start,end,text)=>({id:`original-${start}`,startSeconds:start,endSeconds:end,text,translated:false});
const ordinary=Array.from({length:34},(_,i)=>row(i*6,Math.min(202,i*6+5),`영상에 실제로 나오는 독립적인 설명 ${i}입니다.`));
assert.deepEqual(planSpeechRepairWindows(ordinary,202),planSpeechCoverageWindows(202),'No transition means the established two middle checks remain unchanged');
// Real-life regression shape: the prior sentence ends near 02:09 and a line
// starts "그다음에" at 02:15, but the missing 02:08-02:15 content creates
// NO 9-second gap. Do not encode any topic or target speech into production.
const partial=ordinary.filter(l=>l.startSeconds!==132);
partial.push(row(135,139,'그다음에 나이 드신 분들은 척추관 협착증과 같은 허리 질환으로 혼동되곤 합니다.'));
const windows=planSpeechRepairWindows(partial,202);
assert.deepEqual(windows[0],{from:121,to:149},'A short focused re-listen covers 02:08 even with no large time gap');
assert(windows.some(w=>w.from===79&&w.to===125),'Original first middle review must survive');
assert(windows.some(w=>w.from===119&&w.to===165),'Original second middle review must survive');
assert.equal(windows.length,3,'Never exceed three extra free video checks');
assert(windows.every(w=>w.to>w.from&&w.to-w.from<=52&&w.from>=0&&w.to<=202));
const request=makeSpeechCoverageRequest('https://www.youtube.com/watch?v=aFmUl65-2-c',windows[0]);
assert.deepEqual(request[0].processing,{type:'static',start_offset:'121s',end_offset:'149s'});
const listen=extractCoverageReviewRows({lines:[
 {startSeconds:7,endSeconds:10,text:'많은 환자분들이 허리 질환으로 혼동되곤 합니다.'},
 {startSeconds:10,endSeconds:13,text:'특히 젊은 사람들은 디스크 탈출증과 혼동되기도 합니다.'},
 {startSeconds:14,endSeconds:18,text:'그다음에 나이 드신 분들은 척추관 협착증 같은 허리 질환으로 많이 혼동되곤 합니다.'},
]},windows[0],202);
assert.equal(listen.invalid,0);
const result=mergeIndependentCoverage(partial,listen.lines,windows[0],202);
assert(result.lines.some(x=>x.text.includes('특히 젊은 사람들은 디스크 탈출증')));
assert(result.lines.some(x=>x.text.includes('많은 환자분들이 허리 질환')));
assert(result.lines.some(x=>x.text.includes('그다음에 나이 드신 분들은')));
assert.equal(result.lines.some(x=>x.startSeconds===0),true,'Do not lose beginning of successful transcript');
assert(!source.includes('디스크 탈출증'),'Video-specific missing sentence must appear only in the regression fixture');
assert.deepEqual(planSpeechRepairWindows(ordinary,90),[],'No extra speech behavior outside existing duration scope');
console.log('PASS: no-gap transition 02:08-02:15 gets focused listen; both middle reviews preserved; no injected speech; <=3 extra calls');
