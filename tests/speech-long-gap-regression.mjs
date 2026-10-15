import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const read=(p)=>fs.readFileSync(p,'utf8');
const compiled=ts.transpileModule(read('lib/speech-coverage-recovery.ts'),{fileName:'lib/speech-coverage-recovery.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length??0,0,'long-gap repair helper must transpile');
const exported={};Function('exports',compiled.outputText)(exported);
const {planSpeechRepairWindows,extractCoverageReviewRows,mergeIndependentCoverage}=exported;
const line=(s,e,t)=>({startSeconds:s,endSeconds:e,text:t,id:`segment-${s}`,translated:false});
const before=[line(0,4,'첫 번째 실제 영상 발언입니다.'),line(34,40,'상수도에 관한 비유입니다.'),line(71,77,'다리의 혈관이 막히는 현상을 설명합니다.'),line(88,95,'환자 사례를 이야기합니다.'),line(168,179,'이렇듯 일상생활에서 확인할 수 있습니다.'),line(188,195,'우리 몸속의 혈관을 점검합니다.'),line(196,200,'감사합니다.')];
const windows=planSpeechRepairWindows(before,202);
assert.equal(windows.length>=2,true,'severe hole MUST reserve two repair calls');
assert.equal(windows.length<=3,true,'bounded request count');
assert(windows.every(w=>w.to-w.from<=52 && w.from>=0 && w.to<=202),'static clips <=52s');
assert(windows[0].from<=95 && windows[1].to>=168,'both ends of the actual missing 95–168s segment must be audible');
assert(windows[0].to-windows[1].from>=6,'two recovery clips overlap to preserve cut-off phrases');
const reviewedA=extractCoverageReviewRows({lines:[
 {startSeconds:104-windows[0].from,endSeconds:108-windows[0].from,text:'환자에게 나타나는 새로운 증상을 설명합니다.'},
 {startSeconds:124-windows[0].from,endSeconds:129-windows[0].from,text:'걷다가 쉬면 증상이 좋아지기도 합니다.'},
]},windows[0],202);
const reviewedB=extractCoverageReviewRows({lines:[
 {startSeconds:137-windows[1].from,endSeconds:142-windows[1].from,text:'다양한 원인에 의해 나타나는 통증을 구별합니다.'},
 {startSeconds:151-windows[1].from,endSeconds:155-windows[1].from,text:'마트 카트에 기대는 자세를 비교합니다.'},
]},windows[1],202);
assert.equal(reviewedA.invalid,0);assert.equal(reviewedB.invalid,0);
const first=mergeIndependentCoverage(before,reviewedA.lines,windows[0],202);
const second=mergeIndependentCoverage(first.lines,reviewedB.lines,windows[1],202);
assert.equal(first.added,2);assert.equal(second.added,2);
assert(second.lines.some(l=>l.text.includes('마트 카트')));
assert(second.lines.some(l=>l.text.includes('걷다가 쉬면')));
assert.equal(second.lines.filter(l=>l.startSeconds===0).length,1,'opening is never lost');
assert(second.lines.some(l=>l.text==='감사합니다.'),'outro survives');
const ordinary=Array.from({length:34},(_,i)=>line(i*6,Math.min(202,i*6+5),`실제로 나온 설명 문장 ${i}번입니다.`));
assert.equal(planSpeechRepairWindows(ordinary,202).length,2,'do not increase review count on previously good transcript');
const ai=read('lib/server/ai.ts');
assert.match(ai,/const splitSevere=Boolean\(/);
assert.match(ai,/Promise\.all\(repairWindows\.slice\(reviewIndex,reviewIndex\+batchSize\)/);
assert.match(ai,/event:'analysis\.speech_severe_gap_unresolved'/);
assert.match(ai,/심각한 발언 누락/);
assert.match(ai,/if\(outcomes\.some\(x=>x\.failure==='FREE_LIMIT'\)\|\|auditQuotaExceeded\)break/);
assert(!read('lib/speech-coverage-recovery.ts').includes('척추관 협착증'),'no hard-coded reference video script');
console.log('PASS: 73s missing speech gets 2 fully covering overlapping clips, bounded parallel requests, independent merge, head/tail preserved, severe-gap warning');
