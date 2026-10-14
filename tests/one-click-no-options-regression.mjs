import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const workspace=read('components/analysis-workspace.tsx');
const page=read('app/analyze/[videoId]/page.tsx');
const home=read('components/video-form.tsx');
for(const [name,source,kind] of [['workspace',workspace,ts.ScriptKind.TSX],['page',page,ts.ScriptKind.TSX],['home',home,ts.ScriptKind.TSX]]){
 const parsed=ts.createSourceFile(name+'.tsx',source,ts.ScriptTarget.Latest,true,kind);
 assert.equal(parsed.parseDiagnostics.length,0,name+' must parse as TSX');
}
assert.match(home,/router\.push\(`\/analyze\/\$\{id\}\?start=1`\)/,'One-click home submission must request immediate analysis');
assert.match(page,/query\.start==='1'/,'Server page must read one-click signal');
assert.match(page,/autoAnalyze=\{query\.start==='1'\}/,'Server page must pass the signal as an explicit prop');
assert.match(workspace,/if\(!autoAnalyze \|\| autoStarted\.current \|\| phase!=='ready' \|\| !video\)/,'Auto start must wait only for video info and not quota fetch');
assert.doesNotMatch(workspace,/if\([^\n]*quota\?\.enabled!==true/,'Quota request must not block auto start');
assert.match(workspace,/window\.setTimeout\(\(\)=>/,'Start must be deferred outside React effect');
assert.match(workspace,/window\.clearTimeout\(startTimer\)/,'Cancel scheduled start on effect cleanup');
assert.match(workspace,/if\(autoStarted\.current \|\| requestController\.current\) return/,'Avoid duplicate automatic analysis');
assert.match(workspace,/autoStarted\.current=true/,'One-shot automatic analysis');
assert.match(workspace,/void begin\(\)/,'Queue analysis, not only navigation');
for(const s of ['free-model-select','영상 처리 방식','분석 깊이 선택','Google 503 발생 시 1회 재시도','짧은 영상 3구간 발언 추출','음성 공백 추가 AI 요청','CaptionInputPanel']){
 assert(!workspace.includes(s),`No visible settings on the automatic workflow: ${s}`);
}
assert.match(workspace,/model=FREE_MODEL/,'Only approved free model');
for(const flag of ['retryOnBusy=false','recoverMissingSpeech=false','segmentShortSpeech=false'])assert(workspace.includes(flag),`No optional extra request by default: ${flag}`);
assert.match(workspace,/autoSpeech:true/,'Preserve the speech-first extraction path');
assert.match(workspace,/phase!=='processing'/,'Show the manual retry button only when not processing');

// Execute the real auto-start effect callback without a React DOM to verify
// one-click readiness, Strict Mode cleanup, and duplicate-call protection.
const parsedWorkspace=ts.createSourceFile('workspace.tsx',workspace,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const effectCallbacks=[];
const walk=node=>{
 if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='useEffect'){
  effectCallbacks.push(node.arguments[0]);
 }
 ts.forEachChild(node,walk);
};
walk(parsedWorkspace);
const effect=effectCallbacks.find(node=>node.getText(parsedWorkspace).includes('autoStarted.current'));
assert(effect,'The automatic launch effect exists');
const runEffect=new Function('autoAnalyze','autoStarted','phase','video','window','requestController','setAutoAttempted','begin',`return (${effect.getText(parsedWorkspace)})();`);
function scenario(enabled,ready=true){
 let count=0,task=null,cancelled=false,attempted=false;
 const win={setTimeout(fn){task=fn;return 42;},clearTimeout(id){if(id===42)cancelled=true;}};
 const start={current:false},request={current:null},video=ready?{id:'test-video'}:null;
 const cleanup=runEffect(enabled,start,'ready',video,win,request,(value)=>{attempted=value;},()=>{count+=1;});
 return {fire(){if(task&&!cancelled)task();},cleanup,started:start,get count(){return count;},get attempted(){return attempted;},get scheduled(){return Boolean(task);},get cancelled(){return cancelled;}};
}
const launched=scenario(true);
assert(launched.scheduled,'Ready video triggers scheduled automatic start even without quota data');
launched.fire();assert.equal(launched.count,1,'Initial click begins once');assert.equal(launched.attempted,true,'React state tracks auto-analysis attempt for rendering');
launched.fire();assert.equal(launched.count,1,'Repeated timer execution cannot duplicate analysis');
const cancelled=scenario(true);cancelled.cleanup();cancelled.fire();assert.equal(cancelled.count,0,'Unmount cancels pending request');
assert.equal(scenario(false).scheduled,false,'Direct visit without main-page click is not automatic');
assert.equal(scenario(true,false).scheduled,false,'Wait for metadata before launching');
assert.match(workspace,/if\(autoAnalyze && new URLSearchParams\(window\.location\.search\)\.get\('start'\)==='1'\)/,'Only consume the start query after request completion');
assert(!effect.getText(parsedWorkspace).includes('replaceState'),'Do not update the route while analysis is still running');

console.log('PASS: main-page one-click auto analysis without settings, quota gating, duplicate submissions or paid fallback');
