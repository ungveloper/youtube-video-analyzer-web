import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(relative){
  const target=path.join(root,relative);
  const out=ts.transpileModule(fs.readFileSync(target,'utf8'),{fileName:target,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(out.diagnostics?.length??0,0);
  const exports={};
  Function('exports','require','module',out.outputText)(exports,()=>{throw new Error('Unexpected runtime dependency')},{exports});
  return exports;
}
const {recoverArticleFromSource,articleOnlyRecoveryPrompt}=load('lib/server/evidence-pipeline.ts');
const source={evidence:[{id:'ev0',kind:'caption',startSeconds:0,endSeconds:20,note:'원본 강연 발언'}],claims:[{id:'claim0',text:'영상에서는 발표자가 주제 정의를 설명한다.',category:'소개',evidenceIds:['ev0']}],transcript:[],exclusions:[]};
const recovered=recoverArticleFromSource({article:[{title:'의미',text:'영상 발언을 바탕으로 주제를 자연스럽게 해설합니다.',claimIds:['claim0']}]},source);
assert.equal(recovered.article.length,1);
assert.deepEqual(recovered.article[0].evidenceIds,['ev0']);
assert.equal(recovered.timeline.length,1);
assert.equal(recovered.summary.length,1);
assert.throws(()=>recoverArticleFromSource({article:[{title:'거짓 인용',text:'원문에 없는 말',claimIds:['fake-id']}]},source));
assert.match(articleOnlyRecoveryPrompt(source,202),/추가하지 않는다/);
for(const name of ['components/analysis-workspace.tsx','components/site-header.tsx','app/page.tsx']){
 const code=fs.readFileSync(path.join(root,name),'utf8');
 assert.doesNotMatch(code,/saveRecord|getRecord|listRecords|\/history|IndexedDB/);
}
console.log('PASS: article-only evidence citations, rejection of invented citations, current-session UI has no persistence');
