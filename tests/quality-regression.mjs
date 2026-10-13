/* Structural regressions; intentionally no provider request or fixture article copied from another service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadSource(relative) {
  const filename=path.join(__dirname,'..',relative);
  const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(output.diagnostics?.length??0,0,relative+' transpile errors');
  const exports={};
  Function('exports','require','module',output.outputText)(exports,(id)=>{if(id==='@/lib/timeline-accuracy')return loadSource('lib/timeline-accuracy.ts');throw new Error('unexpected runtime require: '+id)},{exports});
  return exports;
}
const {fallbackFromSource, sourceMapPrompt, composePrompt, extractComposedContent}=loadSource('lib/server/evidence-pipeline.ts');
const {assessSourceCoverage}=loadSource('lib/quality-audit.ts');
function sourceAt(times) {
 const evidence=times.map((t,i)=>({id:`e${i}`,startSeconds:t,endSeconds:Math.min(202,t+9),kind:'caption',note:`원문 발언 ${i}: 확인 가능한 고유 논점과 구체적인 예시가 있습니다.`}));
 const claims=evidence.map((e,i)=>({id:`c${i}`,text:`고유한 논점 ${i}: 원문에서 실제 제시된 비교와 주의사항 설명입니다.`,category:`논점 ${i}`,evidenceIds:[e.id]}));
 return {evidence,claims,transcript:[],exclusions:[]};
}
const source=sourceAt([0,20,44,65,90,120,150,183]);
const fallback=fallbackFromSource(source);
assert.equal(fallback.article.length,0,'never pass off source notes as article');
assert.equal(fallback.timeline.length,8);
assert.equal(fallback.summary.length,3);
assert.equal(assessSourceCoverage(source,fallback,202,false).qualityStatus,'partial');
const richArticle='실제 확인된 발언에 근거한 독립적인 설명 문단입니다. '.repeat(24);
const rich={summary:source.claims.slice(0,4).map((c,i)=>({id:`s${i}`,title:'요점',text:c.text,evidenceIds:c.evidenceIds})),timeline:source.claims.map((c,i)=>({id:`t${i}`,title:c.category,text:c.text,evidenceIds:c.evidenceIds})),article:[{id:'a1',title:'발언의 맥락과 비교',text:richArticle,evidenceIds:source.evidence.map(e=>e.id)}],transcript:[],exclusions:[]};
assert.equal(assessSourceCoverage(source,rich,202,true).qualityStatus,'review');
const early=sourceAt([0,13,31,50,65,82,91,120]);
assert.equal(assessSourceCoverage(early,rich,202,true).sourceIncomplete,true,'sparse final portion is an advisory');
assert.equal(assessSourceCoverage(early,rich,202,true).qualityStatus,'review','time distribution alone is not proof of article failure');
const duplicate={...rich,article:rich.timeline.map(x=>({...x}))};
assert.equal(assessSourceCoverage(source,duplicate,202,true).duplicatedArticle,true,'copied timeline cannot pass as article');
const composed=extractComposedContent({summary:[{text:'요점',claimIds:['c0']}],timeline:[{text:'타임라인',title:'비교',claimIds:['c1']}],article:[{text:'해설',title:'제목',claimIds:['c2']}]},source);
assert.deepEqual(composed.article[0].evidenceIds,['e2']);
assert.throws(()=>extractComposedContent({summary:[{text:'요약',claimIds:['FAKE']}],timeline:[],article:[]},source));
assert.match(sourceMapPrompt(202),/후반 25%/);
assert.match(composePrompt(source,202),/동일 문장을 세 목록에 복사/);
console.log('PASS: fallback without fake article; timeline preservation; temporal coverage; article duplication; valid claim references; source prompts');
