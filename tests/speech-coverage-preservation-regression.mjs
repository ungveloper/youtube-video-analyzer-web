import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const src=fs.readFileSync(path.resolve('lib/speech-coverage-recovery.ts'),'utf8');
const transpiled=ts.transpileModule(src,{fileName:'lib/speech-coverage-recovery.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(transpiled.diagnostics?.length??0,0,'New helper TS transpiles');
const compiledExports={};Function('exports',transpiled.outputText)(compiledExports);
const {salvageRejectedSpeech,planSpeechCoverageWindows,makeSpeechCoverageRequest,extractCoverageReviewRows,mergeIndependentCoverage}=compiledExports;
const line=(start,end,text)=>({id:`l${start}-${text.slice(0,3)}`,startSeconds:start,endSeconds:end,text,translated:false});
const segments=[{index:3,from:97,to:139,coreFrom:101,coreTo:135},{index:4,from:131,to:172,coreFrom:135,coreTo:168}];
const baseline=[line(101,105,'버거씨병 환자들이 방문하는 특징이 있습니다.'),line(112,117,'쉬면 다시 증상이 호전되는 것이 특징입니다.'),line(133,140,'다리의 온도도 비교가 됩니다.'),line(137,144,'다리도 약간 창백하게 보입니다.')];
// Strict previous parser rejected different text merely for overlapping times.
const outcomes=[{segment:segments[0],parsed:{lines:[
 {startSeconds:4,endSeconds:8,text:'버거씨병 환자들이 방문하는 특징이 있습니다.'},
 {startSeconds:15,endSeconds:19,text:'말초 동맥 폐색의 대표적인 증상은 간헐적 파행입니다.'},
 {startSeconds:15.5,endSeconds:20,text:'걸을 때 종아리와 허벅지에도 통증이 발생합니다.'},
 {startSeconds:39,endSeconds:41,text:'이전 클립 문맥에만 있는 독립적인 발언입니다.'},
]}},{segment:segments[1],parsed:{lines:[
 {startSeconds:2,endSeconds:8,text:'다리의 온도도 비교가 됩니다.'},
 {startSeconds:10,endSeconds:15,text:'마트에서 카트에 기대서 걸으시면 호전되는 경우입니다.'},
]}}];
const salvaged=salvageRejectedSpeech(outcomes,segments,baseline,202);
assert.equal(salvaged.recovered,3,'Three distinct sentences recover despite duplicate time');
assert.equal(salvaged.outsideCore,2,'Only neighboring context does not masquerade as owned phrase');
assert(salvaged.overlappingRecovered>=1,'Overlapping estimates may hold distinct words');
assert(salvaged.lines.some(x=>x.text.includes('간헐적 파행')));
assert(salvaged.lines.some(x=>x.text.includes('카트에 기대서')));
assert.equal(salvaged.lines.filter(x=>x.text==='다리의 온도도 비교가 됩니다.').length,1);
const windows=planSpeechCoverageWindows(202);
assert.equal(windows.length,2);
assert(windows[0].from<=106&&windows[0].to>=118,'Independent first review hears 01:46–01:58');
assert(windows[1].from<=128&&windows[1].to>=156,'Independent second review hears 02:08–02:36');
assert.deepEqual(planSpeechCoverageWindows(100),[]);
assert.deepEqual(planSpeechCoverageWindows(301),[]);
assert(!src.includes('간헐적 파행'),'Production must not hardcode reference phrases');
const request=makeSpeechCoverageRequest('https://www.youtube.com/watch?v=aFmUl65-2-c',windows[0]);
assert.deepEqual(request[0].processing,{type:'static',start_offset:windows[0].from+'s',end_offset:windows[0].to+'s'});
assert(!('name' in request[0])&&!('display_name' in request[0]));
const review1=extractCoverageReviewRows({lines:[
 {startSeconds:106-windows[0].from,endSeconds:110-windows[0].from,text:'말초 동맥의 폐색에 의해 나타나는 대표적인 증상이 간헐적 파행이에요.'},
 {startSeconds:114-windows[0].from,endSeconds:118-windows[0].from,text:'그래서 걷거나 운동할 때 종아리 허벅지 엉덩이에도 발생할 수 있는데요.'},
 {startSeconds:300,endSeconds:301,text:'이 클립에 없는 말입니다.'},
]},windows[0],202);
assert.equal(review1.invalid,1,'Reject times outside real clipped video');
const gapRestored=mergeIndependentCoverage(baseline,review1.lines,windows[0],202);
assert.equal(gapRestored.added,2,'Missing clauses are restored without relying on a fixed wordlist');
// The original app stamped two late remarks ~22s too early. Two independent
// exact phrases seen in a real alternate clip may conditionally correct them.
const second=windows[1];
const review2=extractCoverageReviewRows({lines:[
 {startSeconds:130-second.from,endSeconds:135-second.from,text:'많은 환자분들이 디스크나 척추관 협착증 같은 허리 질환으로 혼동합니다.'},
 {startSeconds:146-second.from,endSeconds:150-second.from,text:'마트에서 허리를 굽혀 카트에 몸을 기대서 걸으시면 호전됩니다.'},
 {startSeconds:157-second.from,endSeconds:161-second.from,text:'다리의 온도도 비교가 됩니다.'},
 {startSeconds:160-second.from,endSeconds:164-second.from,text:'다리도 약간 창백하게 보입니다.'},
]},second,202);
const completed=mergeIndependentCoverage(gapRestored.lines,review2.lines,second,202);
assert.equal(completed.added,2,'Both the disease comparison and cart example were omitted');
assert.equal(completed.corrections,2,'Two same-direction 22s offsets permit bounded correction');
assert.equal(completed.lines.find(l=>l.text==='다리의 온도도 비교가 됩니다.').startSeconds,157);
assert.equal(completed.lines.find(l=>l.text==='다리도 약간 창백하게 보입니다.').startSeconds,160);
assert.equal(completed.lines.filter(x=>x.text.includes('간헐적 파행')).length,1);
const one=mergeIndependentCoverage(baseline,[line(157,161,'다리의 온도도 비교가 됩니다.')],second,202);
assert.equal(one.corrections,0,'One matching phrase cannot arbitrarily shift timestamps');
const fake=mergeIndependentCoverage(baseline,[line(157,161,'이 영상에 없던 설명입니다.')],second,202);
assert.equal(fake.corrections,0,'A wholly new phrase never alters existing timecodes');
const ai=fs.readFileSync('lib/server/ai.ts','utf8');
assert.match(ai,/salvageRejectedSpeech\(outcomes,segments,merged\.lines,video\.durationSeconds\)/);
assert.match(ai,/pass:`speech-coverage-\$\{reviewIndex\}`/);
assert.match(ai,/mergeIndependentCoverage\(finalLines,reviewed\.lines,coverageWindow,video\.durationSeconds\)/);
assert.match(ai,/event:'analysis\.speech_preservation_audit'/);
assert.match(ai,/event:'analysis\.speech_coverage_review'/);
assert.match(ai,/if\(code==='FREE_LIMIT'\)auditQuotaExceeded=true/);
assert.match(ai,/const source=speechSource\(finalLines,video\.durationSeconds\)/);
console.log('PASS: independent 01:46/02:08 coverage; overlap does not delete distinct speech; boundary context excluded; 2-anchor shift; 429 guard');
