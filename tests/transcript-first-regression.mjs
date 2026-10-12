import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(relative){
 const source=fs.readFileSync(path.join(root,relative),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(code.diagnostics?.length||0,0,'ts transpile '+relative);
 const exports={};
 Function('exports','require','module',code.outputText)(exports,()=>{throw Error('Unexpected dynamic require')},{exports});
 return exports;
}
const {parseTimedCaptions}=load('lib/caption-input.ts');
const pasted=parseTimedCaptions('0:00\n첫 부분의 실제 발화\n0:33 다음 정보와 사례\n0:53\n다른 위험 요인\n1:44\n걷는 동안 발생하는 증상과 쉬면 호전되는 설명\n2:08\n다른 질환과의 구별\n2:44\n결론과 주의사항',202);
assert.equal(pasted.length,6);
assert.deepEqual(pasted.map(x=>x.startSeconds),[0,33,53,104,128,164]);
assert.equal(pasted.at(-1).endSeconds,202);
const inline=parseTimedCaptions('0:00 시작\n0:12 중간\n0:44 마무리',62);
assert.equal(inline.length,3);
const srt=parseTimedCaptions('1\n00:00:01,000 --> 00:00:04,000\n안녕하세요\n\n2\n00:00:07,000 --> 00:00:11,000\n두 번째 구간',62);
assert.equal(srt.length,2);
assert.throws(()=>parseTimedCaptions('시간 없는 일반 문장입니다.\n마무리 문장입니다.',62));
const {assessSinglePassCoverage}=load('lib/quality-audit.ts');
function assess(times){
 const evidence=times.map((t,i)=>({id:`e${i}`,startSeconds:t,endSeconds:Math.min(202,t+10),kind:'audio'}));
 const content={summary:[],article:[],transcript:[],exclusions:[],timeline:evidence.map((e,i)=>({id:`t${i}`,title:'제목',text:'발언',evidenceIds:[e.id]}))};
 return assessSinglePassCoverage(evidence,content,202);
}
assert.equal(assess([0,13,35,65,105,120]).incomplete,true,'missing final quarter cannot pass');
assert.equal(assess([0,22,33,52,85,115,132,143,180]).incomplete,false,'full coverage passes');
const ai=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
assert.match(ai,/if\(provided\)\{/);
assert.match(ai,/source=provided;/);
assert.match(ai,/!provided && !composeRecovery/);
assert.match(ai,/assessSinglePassCoverage\(result.evidence/);
console.log('PASS: pasted YouTube timestamps / SRT / text rejection / tail coverage / caption single pass');
