import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function load(file,dependencies={}){
  const input=fs.readFileSync(path.join(root,file),'utf8');
  const built=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(built.diagnostics?.length||0,0,`TypeScript: ${file}`);
  const exports={};
  Function('exports','require','module',built.outputText)(exports,(id)=>{if(!(id in dependencies))throw new Error(`Unexpected import: ${id}`);return dependencies[id]},{exports});
  return exports;
}
const {timelineTime,timelineFromSourceClaims,timelineFromEvidenceNotes,preserveTimelineDetail}=load('lib/timeline-granularity.ts');
const {parseTimedCaptions}=load('lib/caption-input.ts');
assert.equal(timelineTime(0),'00:00');
assert.equal(timelineTime(33.9),'00:33');
assert.equal(timelineTime(114),'01:54');
assert.equal(timelineTime(3601),'01:00:01');
const start=[0,33,49,53,114,128,143,164,178];
const evidence=start.map((t,i)=>({id:`e${i}`,startSeconds:t,endSeconds:t+5,kind:'audio',note:`시점 ${i}에서 실제 발화로 검증된 서로 다른 구체적 내용입니다.`}));
const claims=start.map((t,i)=>({id:`c${i}`,text:`독립 발언 ${i}: 시간 ${t}초에 확인된 고유한 설명과 구체적 발화입니다.`,evidenceIds:[`e${i}`],category:'원문 발언'}));
const authored=[{id:'topic1',title:'개요',text:'여러 논점을 합친 하나의 문단입니다.',evidenceIds:['e0','e1','e2','e3','e4']},{id:'topic2',title:'종합',text:'후반부의 내용을 모두 합친 문단입니다.',evidenceIds:['e5','e6','e7','e8']}];
const atomic=timelineFromSourceClaims(claims,evidence,authored);
assert.equal(atomic.length,9,'source claims must be independently listed');
assert.deepEqual(atomic.map(x=>evidence.find(e=>e.id===x.evidenceIds[0])?.startSeconds),start);
assert.ok(atomic.every(x=>x.evidenceIds.length===1));
assert.ok(atomic.every(x=>!x.title),'topic headings should not bury timestamp rows');
const coarse=timelineFromSourceClaims(claims.slice(0,1),evidence,authored);
assert.equal(coarse.length,2,'never replace a detailed timeline with fewer claims');
const standard=timelineFromEvidenceNotes(authored,evidence);
assert.equal(standard.length,9,'evidence notes split independently anchored moments');
const richOriginal=[{id:'a',title:'상세 설명',text:'영상의 인과 관계와 구체적 비교 설명이 충분히 작성되어 있습니다. '.repeat(14),evidenceIds:['e0','e1']}];
const tinyAtomic=claims.slice(0,2).map((c,i)=>({id:c.id,title:'',text:c.text,evidenceIds:[`e${i}`]}));
assert.deepEqual(preserveTimelineDetail(richOriginal,tinyAtomic),richOriginal,'never discard detailed source paragraphs in favor of shorter atomized lines');
const noteLess=timelineFromEvidenceNotes([authored[0]],evidence.map((e,i)=>({...e,note:i===2?'':'짧음'})));
assert.equal(noteLess.length,1,'never fabricate content when evidence note is absent');
const {sourceFromUserCaptions}=load('lib/server/caption-source.ts',{'@/lib/caption-input':{parseTimedCaptions}});
const srt=`1
00:00:00,000 --> 00:00:04,000
동맥에 관해 설명합니다.

2
00:00:04,000 --> 00:00:09,000
다음 주제를 설명합니다.

3
00:00:13,000 --> 00:00:16,000
사례를 설명합니다.

4
00:00:16,000 --> 00:00:20,000
마지막 결론입니다.`;
const captionSource=sourceFromUserCaptions(srt,{id:'example-id',title:'example',channel:'test',thumbnail:'',durationSeconds:25,url:'https://www.youtube.com/watch?v=example-id'});
assert.equal(captionSource.evidence.length,4,'punctuation/time break into meaningful source windows');
assert.deepEqual(captionSource.evidence.map(e=>e.startSeconds),[0,4,13,16]);
assert.deepEqual(captionSource.claims.map(c=>c.evidenceIds[0]),['caption-1','caption-2','caption-3','caption-4']);
const cues=parseTimedCaptions('0:00 발언 하나.\n0:08 다음 개념.\n0:20 원인 설명.\n0:33 결론.',40);
assert.equal(cues.length,4);
// A subtitle cue can be split only when a timestamp is available. If a cue
// contains multiple sentences, do NOT invent new start seconds inside it.
assert.deepEqual(cues.map(x=>x.startSeconds),[0,8,20,33]);
const server=fs.readFileSync(path.join(root,'lib/server/ai.ts'),'utf8');
const ui=fs.readFileSync(path.join(root,'components/detailed-analysis-list.tsx'),'utf8');
const exportModule=fs.readFileSync(path.join(root,'lib/exporters.ts'),'utf8');
assert.match(server,/timelineFromSourceClaims\(source\.claims,source\.evidence/);
assert.match(server,/timelineFromEvidenceNotes\(result\.original\.timeline,result\.evidence\)/);
assert.match(ui,/aria-label="발언별 타임라인"/);
assert.match(exportModule,/timelineSection\(c\.timeline,record\.evidence,/);
console.log('PASS: verified MM:SS / per-claim timeline / per-evidence split / no invented times / UI and export integration');
