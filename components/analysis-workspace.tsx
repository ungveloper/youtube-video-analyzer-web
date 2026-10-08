'use client';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import Link from 'next/link';
import { Badge,Button,Card,Tabs } from '@/components/ui/primitives';
import { DetailedAnalysisList } from '@/components/detailed-analysis-list';
import { YouTubePlayerEmbed } from '@/components/youtube-player';
import type { YouTubePlayerHandle } from '@/components/youtube-player';
import { assessDetail } from '@/lib/analysis-detail';
import { FREE_MODELS, FREE_MODEL, type FreeModelId } from '@/lib/free-models';
import { getRecord,listRecords,saveRecord } from '@/lib/storage';
import { exportDocx,exportPdf,exportText,setEdited,toMarkdown } from '@/lib/exporters';
import { extractVideoId,timestamp } from '@/lib/youtube';
import { readAnalysisEvents,stagePercent } from '@/lib/analysis-stream';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import type { AnalysisContent,AnalysisRecord, ApiError,QuotaInfo,VideoInfo } from '@/lib/types';
const tabs=[{value:'summary',label:'요약'},{value:'timeline',label:'타임라인'},{value:'article',label:'아티클'},{value:'transcript',label:'스크립트'}];
type Tab='summary'|'timeline'|'article'|'transcript';
export function AnalysisWorkspace({videoId}:{videoId:string}){
  const valid=extractVideoId(videoId)===videoId;
  const [video,setVideo]=useState<VideoInfo|null>(null);
  const [record,setRecord]=useState<AnalysisRecord|null>(null);
  const [phase,setPhase]=useState<'checking'|'ready'|'processing'|'completed'|'error'>(valid?'checking':'error');
  const [message,setMessage]=useState(valid?'':'올바르지 않은 영상 ID입니다.');const [warning,setWarning]=useState('');
  const [tab,setTab]=useState<Tab>('summary');const [editing,setEditing]=useState(false);
  const [quota,setQuota]=useState<QuotaInfo|null>(null);const [busyExport,setBusyExport]=useState(false);
  const playerRef=useRef<YouTubePlayerHandle|null>(null);
  const [depth,setDepth]=useState<'standard'|'deep'>('deep');
  const [model,setModel]=useState<FreeModelId>(FREE_MODEL);
  const [saveState,setSaveState]=useState('');
  const [progress,setProgress]=useState<AnalysisProgress|null>(null);
  const [elapsed,setElapsed]=useState(0);
  const [startedAt,setStartedAt]=useState<number|null>(null);
  const [failure,setFailure]=useState('');
  const [diagnostic,setDiagnostic]=useState('');
  const [diagnosticBusy,setDiagnosticBusy]=useState(false);
  const requestController=useRef<AbortController|null>(null);
  useEffect(()=>{
    if(startedAt===null)return;
    const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);
    return()=>clearInterval(timer);
  },[startedAt]);
  useEffect(()=>{const controllerRef=requestController;return()=>controllerRef.current?.abort();},[]);
  const stop=()=>requestController.current?.abort();
  async function diagnose() {
    setDiagnosticBusy(true);setDiagnostic('Gemini 모델 정보를 조회하고 있습니다…');
    try {
      const response=await fetch(`/api/ai-diagnostics?model=${encodeURIComponent(model)}`,{cache:'no-store'});
      const data=await response.json() as {ok?:boolean;model?:string;message?:string;httpStatus?:number};
      setDiagnostic(`${data.ok?'모델 정보 조회 성공':'모델 정보 조회 실패'} · ${data.model||'Gemini'} · ${data.message||`HTTP ${data.httpStatus||response.status}`}`);
    } catch {setDiagnostic('진단 서버에 연결할 수 없습니다. 개발 서버를 재시작해주세요.');}
    finally {setDiagnosticBusy(false);}
  }
  const loadQuota=useCallback(async()=>{try{const r=await fetch('/api/quota',{cache:'no-store'});const q=await r.json() as QuotaInfo;setQuota(q);}catch{setQuota(null);}},[]);
  useEffect(()=>{if(!valid)return;let active=true;async function init(){try{
    const params=new URLSearchParams(window.location.search),recordId=params.get('record');let existing:AnalysisRecord|undefined;
    if(recordId)existing=await getRecord(recordId);else{const all=await listRecords();existing=all.find(a=>a.video.id===videoId);}
    if(!active)return;
    if(existing&&existing.video.id===videoId){setRecord(existing);setVideo(existing.video);setPhase('completed');}
    else { const response=await fetch(`/api/video?id=${videoId}`,{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error((body as ApiError).error||'영상 정보를 조회하지 못했습니다.');if(active){setVideo(body as VideoInfo);setPhase('ready');}}
  }catch(e){if(active){setMessage(e instanceof Error?e.message:'데이터를 불러오지 못했습니다.');setPhase('error');}}finally{void loadQuota();}}
  void init();return()=>{active=false};},[videoId,valid,loadQuota]);
  const seek=useCallback((time:number)=>{playerRef.current?.seekAndPlay(time);},[]);
  async function begin(){
    if(!video||phase==='processing')return;
    if(record&&!confirm(`새로운 무료 API 요청을 보냅니다. ${depth==='deep'?'정밀 분석은 2회':'기본 분석은 1회'} 호출합니다. 기존 결과는 브라우저에 남아있습니다. 다시 분석할까요?`))return;
    const controller=new AbortController();requestController.current=controller;
    const requestId=crypto.randomUUID();
    setPhase('processing');setMessage('분석 요청을 준비하고 있습니다.');setWarning('');setFailure('');setEditing(false);
    setProgress({type:'progress',step:0,label:'분석 시작',detail:'서버에 요청을 전달하는 중입니다.'});
    setElapsed(0);setStartedAt(Date.now());
    try{
      const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({videoId:video.id,requestId,depth,model}),signal:controller.signal,cache:'no-store'});
      const result=await readAnalysisEvents(res,event=>{
        if(controller.signal.aborted)return;
        setProgress(event);
        setMessage(event.detail);
      });
      if(controller.signal.aborted)return;
      setProgress({type:'progress',step:4,label:'브라우저에 저장 중',detail:'분석 결과를 IndexedDB에 저장합니다.'});
      try{await saveRecord(result);setSaveState('IndexedDB 저장 완료')}
      catch(e){setSaveState('브라우저 저장 실패');setWarning(`분석은 완료됐지만 저장에 실패했습니다. 결과를 즉시 다운로드해주세요. ${e instanceof Error?e.message:''}`)}
      setRecord(result);setProgress({type:'progress',step:5,label:'완료',detail:'분석 결과가 준비되었습니다.'});setPhase('completed');setMessage('');
      await loadQuota();
    }catch(e){
      const text=controller.signal.aborted?'사용자가 분석을 중단했습니다.':e instanceof Error?e.message:'분석 요청이 실패했습니다.';
      setFailure(text);setMessage(text);setPhase(record?'completed':'ready');
      await loadQuota();
    }finally{
      if(requestController.current===controller)requestController.current=null;
      setStartedAt(null);
    }
  }

  const changed=record?JSON.stringify(record.original)!==JSON.stringify(record.edited):false;
  function changeItem(target:Tab,id:string,text:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:setEdited(prev.edited,target,id,text)}:prev);setSaveState('저장 대기 중');}
  function changeTitle(target:'summary'|'timeline'|'article',id:string,title:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:{...prev.edited,[target]:prev.edited[target].map(v=>v.id===id?{...v,title,edited:true}:v)}}:prev);setSaveState('저장 대기 중');}
  function changeExclusions(text:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:{...prev.edited,exclusions:text.split('\n').map(v=>v.trim()).filter(Boolean)}}:prev);setSaveState('저장 대기 중');}
  useEffect(()=>{if(!record||saveState!=='저장 대기 중')return;const timeout=setTimeout(()=>{void saveRecord(record).then(()=>setSaveState('자동 저장 완료')).catch(()=>setSaveState('저장 실패 — 브라우저 저장 공간을 확인해주세요.'));},600);return()=>clearTimeout(timeout);},[record,saveState]);
  async function reset(){if(!record||!confirm('이 결과에서 사용자 수정 내용을 모두 버리고 최초 AI 결과로 복원할까요?'))return;const next={...record,updatedAt:new Date().toISOString(),edited:structuredClone(record.original)};setRecord(next);try{await saveRecord(next);setSaveState('원본 복원 완료')}catch{setSaveState('저장 실패')}}
  async function exportTo(kind:'md'|'txt'|'docx'|'pdf'){if(!record)return;setBusyExport(true);try{if(kind==='md'||kind==='txt')exportText(record,kind);else if(kind==='docx')exportDocx(record);else await exportPdf(record);}catch(e){setWarning(e instanceof Error?e.message:'문서 생성에 실패했습니다.')}finally{setBusyExport(false)}}
  async function copy(){if(!record)return;const content:AnalysisContent=record.edited;const value=tab==='transcript'?content.transcript.map(l=>`[${timestamp(l.startSeconds)}] ${l.text}`).join('\n'):content[tab].map(x=>`${x.title?x.title+'\n':''}${x.text}`).join('\n\n');try{await navigator.clipboard.writeText(value||toMarkdown(record));setSaveState('복사 완료')}catch{setWarning('클립보드 복사 권한을 확인해주세요.')}}
  const selected=useMemo(()=>record?.edited[tab]??[],[record,tab]);
  const density=useMemo(()=>record?assessDetail(record.original,record.video.durationSeconds):null,[record]);
  const labeledTabs=useMemo(()=>tabs.map(item=>({ ...item,label:record?`${item.label} ${record.edited[item.value as Tab].length}`:item.label})),[record]);
  return <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-9">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><Link href="/" className="text-xs text-slate-400 hover:text-white">← 다른 영상 분석</Link><h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">영상 분석 작업 공간</h1></div><div className="flex flex-wrap items-center gap-2"><Badge>최대 30분</Badge><Badge>{quota?.enabled?'개인용 무료 AI':'AI 연결 준비 필요'}</Badge></div></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="space-y-4 lg:sticky lg:top-5">
        <Card className="overflow-hidden">{valid?<YouTubePlayerEmbed ref={playerRef} videoId={videoId} durationSeconds={video?.durationSeconds}/>:<p className="p-6">잘못된 영상 ID</p>}<div className="p-5"><h2 className="font-semibold leading-7">{video?.title||'영상 정보를 확인하는 중입니다'}</h2><p className="mt-1 text-sm text-slate-400">{video?.channel||'YouTube'} {video?.durationSeconds?`· ${timestamp(video.durationSeconds)}`:''}</p><a className="mt-3 inline-block text-xs text-indigo-300 hover:underline" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">YouTube에서 원본 보기 ↗</a></div></Card>
        <Card className="p-5"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">분석 상태</h3><Badge>{({checking:'조회 중',ready:'준비',processing:'분석 중',completed:'완료',error:'오류'})[phase]}</Badge></div>
        {failure&&<div role="alert" className="mt-3 rounded-xl border border-rose-700/50 bg-rose-950/30 px-3 py-3 text-sm leading-6 text-rose-200"><strong className="block font-semibold">분석을 완료하지 못했습니다</strong>{failure}</div>}
        <p role="status" className="mt-3 text-sm leading-7 text-slate-400">{message||(phase==='completed'?'브라우저에 저장된 분석 결과입니다.':phase==='ready'?'공개 영상을 확인했습니다. 무료 Gemini API 설정이 활성화되면 시작할 수 있습니다.':'입력 자료와 서버 설정을 확인합니다.')}</p>
        {phase==='processing'&&<div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex items-center gap-3"><span aria-hidden="true" className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-300/25 border-t-indigo-300"/><div className="min-w-0 flex-1"><p className="text-sm font-medium text-indigo-100">{progress?.label||'분석 준비 중'}</p><p className="mt-1 text-xs text-slate-400">경과 {Math.floor(elapsed/60)}분 {String(elapsed%60).padStart(2,'0')}초 {progress?.attempt?`· 시도 ${progress.attempt}/2`:''}</p></div><span className="text-sm font-semibold tabular-nums text-indigo-200">{stagePercent(progress?.step??0)}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="분석 작업 단계 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stagePercent(progress?.step??0)}><div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{width:`${stagePercent(progress?.step??0)}%`}}/></div>
          <p className="text-xs leading-5 text-slate-500">표시된 %는 영상 확인·응답 수신 등 완료된 <strong>작업 단계 기준</strong>입니다. Gemini 내부 분석률은 확인할 수 없으며 분석 중 수치가 유지될 수 있습니다.</p>
          <Button type="button" variant="secondary" className="w-full" onClick={stop}>진행 중인 분석 중단</Button>
        </div>}
        <div className="mt-4 space-y-2 rounded-xl border border-indigo-500/20 bg-slate-950/50 p-3"><label htmlFor="free-model-select" className="block text-xs font-semibold text-slate-200">무료 Gemini 모델</label><select id="free-model-select" value={model} disabled={phase==='processing'} onChange={e=>{setModel(e.target.value as FreeModelId);setDiagnostic('');}} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100">{FREE_MODELS.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><p className="text-xs leading-5 text-slate-500">선택한 모델의 Free Tier 사용 가능 여부는 AI Studio 프로젝트에서 확인해야 합니다. 유료 등급 키는 사용하지 마세요. 자동 유료 전환은 없습니다.</p></div>
        <div className="mt-4 space-y-2 rounded-xl border border-indigo-500/20 bg-slate-950/50 p-3"><p className="text-xs font-semibold text-slate-200">분석 깊이</p><div className="grid grid-cols-2 gap-2" role="group" aria-label="AI 분석 깊이 선택"><button type="button" aria-pressed={depth==='standard'} disabled={phase==='processing'} onClick={()=>setDepth('standard')} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${depth==='standard'?'border-indigo-400 bg-indigo-500/20 text-indigo-100':'border-slate-700 text-slate-400'}`}>기본 · 1회 호출</button><button type="button" aria-pressed={depth==='deep'} disabled={phase==='processing'} onClick={()=>setDepth('deep')} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${depth==='deep'?'border-indigo-400 bg-indigo-500/20 text-indigo-100':'border-slate-700 text-slate-400'}`}>정밀 · 최대 2회 호출</button></div><p className="text-xs leading-5 text-slate-500">정밀 분석은 영상 근거 추출 1회 + 해당 근거로 상세 문서 작성 1회, 총 2회 호출합니다. 두 번째는 영상 URL을 다시 보내지 않는 텍스트 전용 요청입니다. 무료 할당량을 더 사용하지만 유료 전환은 하지 않습니다.</p></div>
        <Button className="mt-4 w-full" onClick={begin} disabled={!video||phase==='processing'||phase==='checking'||phase==='error'||(quota?.enabled!==true)}>{phase==='processing'?<><span aria-hidden="true" className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"/>분석 요청 처리 중…</>:record?`다시 분석 (${depth==='deep'?'최대 2회':'1회'} 무료 호출)`:`${depth==='deep'?'정밀':'기본'} AI 분석 시작`}</Button>
        <Button type="button" variant="secondary" className="mt-2 w-full" disabled={diagnosticBusy||phase==='processing'} onClick={diagnose}>{diagnosticBusy?'모델 연결 확인 중…':'무료 모델 연결 진단 (AI 분석 호출 없음)'}</Button>
        {diagnostic&&<p role="status" className="mt-2 break-words rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs leading-6 text-slate-300">{diagnostic}</p>}
        {record&&<p className="mt-3 text-xs text-slate-500">기존 결과 재열람은 API를 호출하지 않습니다. 새 분석은 무료 등급 요청 한도를 사용합니다.</p>}</Card>
        <Card className="p-5 text-xs leading-6 text-slate-400"><p className="font-semibold text-slate-200">중요 안내</p><p className="mt-2">AI 분석은 원본 내용을 완벽하게 보증하지 않습니다. 시간 근거는 반드시 영상을 재생해 확인하세요. 원문을 확보하지 못한 경우 스크립트를 만들지 않습니다.</p><p className="mt-2">브라우저를 닫으면 진행 중인 분석 결과가 유실될 수 있습니다.</p></Card>
      </div>
      <Card className="min-w-0 overflow-hidden"><div className="border-b border-slate-800 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">분석 결과</h2><p className="mt-1 text-xs text-slate-500">한국어 · 근거 연결 · 상세 해설 · 브라우저 저장</p></div>{record&&<Badge>{changed?'사용자 편집본':'AI 원본'}</Badge>}</div>{record?.analysisMeta&&<p className="mt-2 text-xs text-slate-400">{record.analysisMeta.depth==='deep'?'정밀 분석':'기본 분석'} · {record.model} · 실제 무료 AI 호출 {record.analysisMeta.providerCalls}회{record.analysisMeta.refinement==='improved'?' · 근거 추출 → 상세 문서 완성':record.analysisMeta.refinement==='kept-first'?' · 문서 생성 실패: 근거 요지만 제공':''}{record.analysisMeta.sourceClaims?` · 확인된 논점 ${record.analysisMeta.sourceClaims}개`:''}</p>}<div className="mt-4"><Tabs value={tab} onChange={v=>{setTab(v as Tab);setEditing(false)}} items={labeledTabs}/></div></div>
        <div className="min-h-[350px] p-4 sm:p-6">{warning&&<div role="alert" className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 text-sm text-amber-200">{warning}</div>}
        {record&&density&&density.shortFields.length>0&&<div className="mb-5 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-xs leading-6 text-slate-300"><p className="font-semibold text-slate-100">영상 정보에 비해 분석이 간략할 수 있습니다</p><p className="mt-1">{density.shortFields.join(' · ')} 항목이 적거나 설명이 짧습니다. 실제 영상의 확인 가능한 발화가 적거나 AI 출력이 간결했을 수 있습니다. 정밀 분석은 영상 근거 추출과 텍스트 해설 작성을 분리하지만, 원본에서 확인되지 않은 내용은 생성하지 않습니다.</p></div>}
        {!record?<div className="flex min-h-[310px] flex-col items-center justify-center text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 text-3xl text-indigo-300">{phase==='processing'?<span aria-hidden="true" className="h-9 w-9 animate-spin rounded-full border-[3px] border-indigo-300/20 border-t-indigo-300"/>:'✦'}</div><h3 className="text-lg font-semibold">{phase==='processing'?'AI가 영상을 분석하고 있습니다':'아직 분석 결과가 없습니다'}</h3><p className="mt-3 max-w-sm text-sm leading-7 text-slate-400">{phase==='processing'?'진행 상태와 경과 시간을 왼쪽 패널에서 확인할 수 있습니다. 분석 중에는 이 화면을 유지해주세요.':'영상 정보를 확인하고 AI 분석을 시작하면 요약·타임라인·아티클·스크립트가 여기에 표시됩니다. 설정 전에는 가상 결과를 생성하지 않습니다.'}</p></div>:
        <><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{selected.length}개 항목 {tab==='transcript'?'· 원문 확보 시에만 제공':''}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setEditing(x=>!x)}>{editing?'편집 종료':'편집'}</Button><Button variant="ghost" onClick={reset} disabled={!changed}>원본 복원</Button><Button variant="ghost" onClick={copy}>복사</Button></div></div>
        {selected.length===0?<div className="rounded-xl border border-dashed border-slate-700 p-8 text-sm leading-7 text-slate-400">{tab==='transcript'?'원문 전사를 확보하지 못해 정확한 스크립트를 제공할 수 없습니다.':'검증 가능한 근거를 확보하지 못해 이 영역은 비어 있습니다.'}</div>:<DetailedAnalysisList tab={tab} items={selected} evidence={record.evidence} editing={editing} onSeek={seek} onTextChange={(id,text)=>changeItem(tab,id,text)} onTitleChange={(id,title)=>changeTitle(tab as 'summary'|'timeline'|'article',id,title)}/>}
        {(record.edited.exclusions.length>0||editing)&&<div className="mt-6 rounded-xl border border-amber-700/40 bg-amber-900/10 p-4"><h3 className="text-sm font-semibold text-amber-200">확인할 수 없어 제외한 내용</h3>{editing?<textarea aria-label="분석에서 제외된 내용 편집" className="mt-3 min-h-24 w-full rounded-lg border border-amber-800 bg-slate-950 p-3 text-xs leading-6 text-amber-100 focus:outline-none" value={record.edited.exclusions.join('\n')} onChange={e=>changeExclusions(e.target.value)}/>:<ul className="mt-2 list-inside list-disc text-xs leading-6 text-amber-100/80">{record.edited.exclusions.map((s,i)=><li key={i}>{s}</li>)}</ul>}</div>}
        <div className="mt-6 border-t border-slate-800 pt-5"><p className="text-xs text-slate-500" role="status">{saveState||'결과는 현재 브라우저에만 저장됩니다.'}</p><h3 className="mt-4 mb-3 text-sm font-semibold">전체 결과 다운로드</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('md')}>Markdown</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('txt')}>TXT</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('pdf')}>PDF</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('docx')}>Word</Button></div><p className="mt-3 text-xs leading-6 text-slate-500">다운로드는 편집본 기준입니다. PDF는 한국어 표시를 위해 페이지 이미지를 사용하므로 본문을 텍스트로 선택할 수 없습니다.</p></div></>}
        </div></Card>
    </div>
  </main>
}
