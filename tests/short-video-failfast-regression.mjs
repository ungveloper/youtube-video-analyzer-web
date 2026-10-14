import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const transpile=(source,file)=>{
  const result=ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics?.length??0,0,file);
  return result.outputText;
};
const policy={};Function('exports',transpile(read('lib/speech-clip-recovery.ts'),'lib/speech-clip-recovery.ts'))(policy);
const ai=read('lib/server/ai.ts');
const start=ai.indexOf('function speechClipFailureMessage(');
const end=ai.indexOf('\nexport async function analyzeVideo(');
assert(start>0&&end>start,'Extract real server implementation to simulate provider calls');
const fnCode=transpile(ai.slice(start,end),'speech-focused.ts');
class ServiceError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const segs=[{index:0,from:0,to:67},{index:1,from:67,to:135},{index:2,from:135,to:202}];
function setup(response){
 const calls=[],events=[];let waits=0;
 const valid=(segment)=>({lines:[{startSeconds:1,endSeconds:4,text:`${segment.index}구간 실제 발언으로 가정한 모의 문장입니다.`}]});
 const deps={
  ...policy,
  ServiceError,
  FREE_MODELS:[{id:'gemini-3.8-flash'},{id:'gemini-3.5-flash-lite'}],
  shortSpeechSegments:()=>segs,
  makeSpeechClipRequest:(uri,segment)=>[{type:'video',uri,processing:{type:'static',start_offset:`${segment.from}s`,end_offset:`${segment.to}s`}}],
  waitBeforeProviderRetry:async()=>{waits++;},
  interaction:async args=>{
    calls.push({model:args.model,pass:args.pass,timeoutMs:args.timeoutMs,processing:args.input[0]?.processing});
    const answer=await response(args,calls.length);
    if(typeof answer==='string')throw new ServiceError(answer,'Simulated provider failure',answer==='PROVIDER_BUSY'?503:502);
    return {parsed:answer??valid(segs[Number(args.pass.split('-').at(-1))]??segs[2])};
  },
  clipSpeechFormat:{},composedResponseFormat:{},
  collectSpeechClipResults:(outcomes,segments)=>{
    const lines=outcomes.flatMap(o=>((o.parsed?.lines)||[]).map(l=>({...l,id:`l${o.segment.index}`,startSeconds:l.startSeconds+o.segment.from,endSeconds:l.endSeconds+o.segment.from})));
    const coveredSegments=[...new Set(lines.map(l=>segs.find(s=>l.startSeconds>=s.from&&l.startSeconds<s.to)?.index))];
    return {lines:lines.sort((a,b)=>a.startSeconds-b.startSeconds),coveredSegments,failedSegments:segments.filter(s=>!coveredSegments.includes(s.index)).map(s=>s.index),missingWindows:segments.filter(s=>!coveredSegments.includes(s.index)).map(s=>({from:s.from,to:s.to})),rejected:0};
  },
  speechSource:(lines)=>({claims:lines.map((l,i)=>({id:`c${i}`,text:l.text})),evidence:lines.map((l,i)=>({id:`e${i}`,startSeconds:l.startSeconds,endSeconds:l.endSeconds,note:l.text})),transcript:lines}),
  fallbackFromSource:()=>({summary:[],timeline:[],article:[],transcript:[],exclusions:[]}),
  composePrompt:()=>'compose',extractComposedContent:()=>({summary:[],timeline:[],article:[],transcript:[],exclusions:[]}),
  speechFirstTimeline:(lines,evidence)=>({timeline:lines.map((l,i)=>({id:`t${i}`,text:l.text})),evidence}),
  formatMissingWindows:windows=>windows.map(w=>`${w.from}-${w.to}`).join(','),
  recordFromContent:(video,model,evidence,content)=>({video,model,evidence,original:content,edited:structuredClone(content)}),
 };
 const identifiers=Object.keys(deps);
 const analyze=Function(...identifiers,fnCode+'\nreturn speechFocusedAnalysis;')(...Object.values(deps));
 return {run:()=>analyze({id:'aFmUl65-2-c',url:'https://www.youtube.com/watch?v=aFmUl65-2-c',durationSeconds:202},'gemini-3.8-flash','test-key','request-1',e=>events.push(e)),calls,events,get waits(){return waits;}};
}
// Same outage as the reported log: no other clip calls, just two real-video probes.
const outage=setup(()=> 'PROVIDER_BUSY');
await assert.rejects(outage.run(),e=>e.code==='PROVIDER_BUSY'&&e.status===503);
assert.deepEqual(outage.calls.map(c=>[c.model,c.pass]),[['gemini-3.8-flash','speech-clip-2'],['gemini-3.5-flash-lite','speech-clip-2']]);
assert(outage.calls.every(c=>c.timeoutMs===45000));
assert.equal(outage.waits,1);

// Quota exhaustion and request denial must NOT trigger an extra paid/free probe.
for(const code of ['FREE_LIMIT','GOOGLE_REQUEST_REJECTED']){
 const scenario=setup(()=>code);
 await assert.rejects(scenario.run(),e=>e.code===code);
 assert.equal(scenario.calls.length,1,`No fallback for ${code}`);
}

// A successful alternate free model owns ALL later clips and the compose step.
const recovered=setup(args=>args.model==='gemini-3.8-flash'?'PROVIDER_BUSY':null);
const record=await recovered.run();
assert.equal(record.model,'gemini-3.5-flash-lite');
assert.equal(record.original.transcript.length,3);
assert.deepEqual(record.original.transcript.map(l=>l.startSeconds),[1,68,136]);
assert.equal(record.analysisMeta.providerCalls,5);
assert.equal(recovered.calls.length,5);
assert(recovered.calls.slice(1).every(c=>c.model==='gemini-3.5-flash-lite'));
assert.deepEqual(recovered.calls.slice(2,4).map(c=>c.pass).sort(),['speech-clip-0','speech-clip-1']);
assert.equal(recovered.calls[4].pass,'speech-compose');
assert(record.original.exclusions.some(s=>s.includes('허용된 다른 무료 모델')));

// Successful first probe with failed middle clips must preserve partial speech.
const partial=setup(args=>args.pass==='speech-clip-2'||args.pass==='speech-compose'?null:'PROVIDER_BUSY');
const partialRecord=await partial.run();
assert.equal(partialRecord.model,'gemini-3.8-flash');
assert.equal(partialRecord.original.transcript.length,1);
assert.equal(partialRecord.analysisMeta.qualityStatus,'partial');
assert.equal(partial.calls.length,4);
assert(partialRecord.original.exclusions.some(s=>s.includes('발언을 확인하지 못한 시간 구간')));

console.log('PASS: simulated 503 x2 exits after 2 calls; 429/permission no fallback; free-only model recovery; partial speech retained');
