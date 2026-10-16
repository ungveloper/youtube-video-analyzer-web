'use client';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge,Button,Card,Tabs } from '@/components/ui/primitives';
import { DetailedAnalysisList } from '@/components/detailed-analysis-list';
import { YouTubePlayerEmbed } from '@/components/youtube-player';
import {assessTimelineTiming, parseTimelineTime, timelineStartSeconds} from '@/lib/timeline-accuracy';
import {timelineTime} from '@/lib/timeline-granularity';
import type { YouTubePlayerHandle } from '@/components/youtube-player';
import { assessDetail } from '@/lib/analysis-detail';
import { FREE_MODEL } from '@/lib/free-models';
import { exportDocx,exportPdf,exportText,setEdited,toMarkdown } from '@/lib/exporters';
import { extractVideoId,timestamp } from '@/lib/youtube';
import { readAnalysisEvents,stagePercent } from '@/lib/analysis-stream';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import type { AnalysisContent,AnalysisRecord, ApiError,QuotaInfo,VideoInfo } from '@/lib/types';
const tabs=[{value:'summary',label:'요약'},{value:'timeline',label:'타임라인'},{value:'article',label:'아티클'},{value:'transcript',label:'스크립트'}];
type Tab='summary'|'timeline'|'article'|'transcript';
export function AnalysisWorkspace({videoId,autoAnalyze=false}:{videoId:string;autoAnalyze?:boolean}){
  const valid=extractVideoId(videoId)===videoId;
  const [video,setVideo]=useState<VideoInfo|null>(null);
  const [record,setRecord]=useState<AnalysisRecord|null>(null);
  const [phase,setPhase]=useState<'checking'|'ready'|'processing'|'completed'|'error'>(valid?'checking':'error');
  const [message,setMessage]=useState(valid?'':'올바르지 않은 영상 ID입니다.');const [warning,setWarning]=useState('');
  const [tab,setTab]=useState<Tab>('summary');const [editing,setEditing]=useState(false);
  const [quota,setQuota]=useState<QuotaInfo|null>(null);const [busyExport,setBusyExport]=useState(false);
  const playerRef=useRef<YouTubePlayerHandle|null>(null);
  // Safe fixed defaults: the user starts analysis once on the homepage.
  const model=FREE_MODEL;
  const depth='standard' as const;
  const videoProcessing='auto' as const;
  const retryOnBusy=false;
  const recoverMissingSpeech=false;
  const segmentShortSpeech=false;

  const [notice,setNotice]=useState('');
  const [progress,setProgress]=useState<AnalysisProgress|null>(null);
  const [elapsed,setElapsed]=useState(0);
  const [startedAt,setStartedAt]=useState<number|null>(null);
  const [failure,setFailure]=useState('');
  const requestController=useRef<AbortController|null>(null);
  const autoStarted=useRef(false);
  const [autoAttempted,setAutoAttempted]=useState(false);
  useEffect(()=>{
    if(startedAt===null)return;
    const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);
    return()=>clearInterval(timer);
  },[startedAt]);
  useEffect(()=>{const controllerRef=requestController;return()=>controllerRef.current?.abort();},[]);
  const stop=()=>{requestController.current?.abort();};
  const loadQuota=useCallback(async()=>{try{const r=await fetch('/api/quota',{cache:'no-store'});const q=await r.json() as QuotaInfo;setQuota(q);}catch{setQuota(null);}},[]);
  useEffect(()=>{if(!valid)return;let active=true;async function init(){try{
    const response=await fetch(`/api/video?id=${videoId}`,{cache:'no-store'});
    const body=await response.json();
    if(!response.ok)throw new Error((body as ApiError).error||'영상 정보를 조회하지 못했습니다.');
    if(active){setVideo(body as VideoInfo);setPhase('ready');}
  }catch(e){if(active){setMessage(e instanceof Error?e.message:'영상 정보를 불러오지 못했습니다.');setPhase('error');}}
    finally{void loadQuota();}}
  void init();return()=>{active=false};},[videoId,valid,loadQuota]);
  const seek=useCallback((time:number)=>{playerRef.current?.seekAndPlay(time);},[]);
  async function begin(){
    if(!video||phase==='processing'||requestController.current)return;
    if(record&&!confirm(`기존 분석 결과를 새 결과로 교체합니다. 공개 자막이 없는 2~5분 영상은 발언 추출 3회와 문서 작성 1회 등 무료 Gemini API 호출을 최대 4회 사용합니다. 유료 모델로 전환하지 않습니다. 필요한 결과를 다운로드하셨나요?`))return;
    const controller=new AbortController();requestController.current=controller;
    const requestId=crypto.randomUUID();
    setPhase('processing');setMessage('분석 요청을 준비하고 있습니다.');setWarning('');setFailure('');setNotice('');setEditing(false);
    setProgress({type:'progress',step:0,label:'분석 시작',detail:'서버에 요청을 전달하는 중입니다.'});
    setElapsed(0);setStartedAt(Date.now());
    // Analysis has a dedicated progress panel; avoid a second loading/error notification.
    toast.dismiss('yva-analysis');
    try{
      const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({videoId:video.id,requestId,depth,model,videoProcessing,retryOnBusy,recoverMissingSpeech,segmentShortSpeech,autoSpeech:true}),signal:controller.signal,cache:'no-store'});
      const result=await readAnalysisEvents(res,event=>{
        if(controller.signal.aborted)return;
        setProgress(event);
        setMessage(event.detail);
      });
      if(controller.signal.aborted)return;
      setProgress({type:'progress',step:4,label:'결과 준비 중',detail:'분석 결과를 현재 화면에 표시합니다.'});
      setRecord(result);toast[result.analysisMeta?.qualityStatus==='partial'?'warning':'success'](result.analysisMeta?.qualityStatus==='partial'?'부분 분석 결과가 준비됐습니다.':'영상 분석이 완료됐습니다.', {description:'시간과 원문은 영상으로 확인해주세요.'});setNotice('이 결과는 현재 탭에서만 유지됩니다. 필요한 내용은 다운로드해주세요.');setProgress({type:'progress',step:5,label:'완료',detail:'분석 결과가 준비되었습니다.'});setPhase('completed');setMessage('');
      await loadQuota();
    }catch(e){
      const text=controller.signal.aborted?'사용자가 분석을 중단했습니다.':e instanceof Error?e.message:'분석 요청이 실패했습니다.';
      setFailure(controller.signal.aborted?'':text);setMessage('');setPhase(record?'completed':'ready');
      // The full error is shown once in the inline alert; no duplicate 503 Sonner toast.
      if(controller.signal.aborted)toast.info('분석을 중단했습니다.');
      await loadQuota();
    }finally{
      if(requestController.current===controller)requestController.current=null;
      // Do not mutate Next's active route while its streamed analysis is running.
      // Clear the one-click query only after the initial attempt has ended.
      if(autoAnalyze && new URLSearchParams(window.location.search).get('start')==='1'){
        window.history.replaceState(window.history.state,'',window.location.pathname);
      }
      setStartedAt(null);
    }
  }

  useEffect(()=>{
    if(!autoAnalyze || autoStarted.current || phase!=='ready' || !video) return;
    // The explicit home-page action is authoritative. Quota status is informational;
    // the /api/analyze server route enforces the personal Free Tier configuration.
    const startTimer=window.setTimeout(()=>{
      if(autoStarted.current || requestController.current) return;
      autoStarted.current=true;
      setAutoAttempted(true);
      void begin();
    },0);
    return()=>window.clearTimeout(startTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[autoAnalyze,video,phase]);

  const changed=record?JSON.stringify(record.original)!==JSON.stringify(record.edited):false;
  function changeItem(target:Tab,id:string,text:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:setEdited(prev.edited,target,id,text)}:prev);setNotice('현재 화면에 편집 내용 반영됨 · 다운로드해야 보관됩니다.');}
  function editTimelineTime(id:string,start:number|null){
    if(!record)return;
    const value=window.prompt('실제 영상의 발언 시각을 확인해 MM:SS 또는 HH:MM:SS 형식으로 입력하세요.', start===null?'00:00':timelineTime(start));
    if(value===null)return;
    const seconds=parseTimelineTime(value,record.video.durationSeconds);
    if(seconds===null){toast.error('시간 형식을 확인해주세요.',{description:`MM:SS · 영상 길이 ${timelineTime(record.video.durationSeconds)} 이내`});return;}
    setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:{...prev.edited,timeline:prev.edited.timeline.map(item=>item.id===id?{...item,timeOverrideSeconds:seconds,edited:true}:item)}}:prev);
    setNotice('수정한 시각은 현재 화면과 다운로드 문서에 반영됩니다.');
    toast.success(`${timelineTime(seconds)}로 시각을 수정했습니다.`);
  }
  function changeTitle(target:'summary'|'timeline'|'article',id:string,title:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:{...prev.edited,[target]:prev.edited[target].map(v=>v.id===id?{...v,title,edited:true}:v)}}:prev);setNotice('현재 화면에 편집 내용 반영됨 · 다운로드해야 보관됩니다.');}
  function changeExclusions(text:string){setRecord(prev=>prev?{...prev,updatedAt:new Date().toISOString(),edited:{...prev.edited,exclusions:text.split('\n').map(v=>v.trim()).filter(Boolean)}}:prev);setNotice('현재 화면에 편집 내용 반영됨 · 다운로드해야 보관됩니다.');}
  function reset(){if(!record||!confirm('이 결과의 편집 내용을 버리고 최초 AI 결과로 복원할까요?'))return;setRecord({...record,updatedAt:new Date().toISOString(),edited:structuredClone(record.original)});setNotice('AI 원본으로 복원했습니다.');toast.success('AI 원본으로 복원했습니다.');}
  async function exportTo(kind:'md'|'txt'|'docx'|'pdf'){if(!record)return;setBusyExport(true);try{if(kind==='md'||kind==='txt')exportText(record,kind);else if(kind==='docx')exportDocx(record);else await exportPdf(record);toast.success(`${({md:'Markdown',txt:'TXT',docx:'Word',pdf:'PDF'})[kind]} 다운로드를 시작했습니다.`);}catch(e){const text=e instanceof Error?e.message:'문서 생성에 실패했습니다.';setWarning(text);toast.error('다운로드에 실패했습니다.',{description:text});}finally{setBusyExport(false)}}
  async function copy(){if(!record)return;const content:AnalysisContent=record.edited;const value=tab==='transcript'?content.transcript.map(l=>`[${timestamp(l.startSeconds)}] ${l.text}`).join('\n'):tab==='timeline'?content.timeline.map(x=>{const seconds=timelineStartSeconds(x,record.evidence);return `${seconds===null?'[시간 미확인]':`[${timelineTime(seconds)}]`} ${x.text}`;}).join('\n\n'):content[tab].map(x=>`${x.title?x.title+'\n':''}${x.text}`).join('\n\n');try{await navigator.clipboard.writeText(value||toMarkdown(record));setNotice('클립보드에 복사했습니다.');toast.success('클립보드에 복사했습니다.');}catch{setWarning('클립보드 복사 권한을 확인해주세요.');toast.error('복사에 실패했습니다.',{description:'브라우저의 클립보드 권한을 확인해주세요.'});}}
  const selected=useMemo(()=>record?.edited[tab]??[],[record,tab]);
  const timeReview=useMemo(()=>record?assessTimelineTiming(record.edited.timeline,record.evidence,record.video.durationSeconds):null,[record]);
  const timedFromCaptions=record?.analysisMeta?.sourceMode==='user-captions'||record?.analysisMeta?.sourceMode==='public-captions';
  const density=useMemo(()=>record?assessDetail(record.original,record.video.durationSeconds):null,[record]);
  const labeledTabs=useMemo(()=>tabs.map(item=>({ ...item,label:record?`${item.label} ${record.edited[item.value as Tab].length}`:item.label})),[record]);
  return <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-9">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><Link href="/" className="text-xs text-slate-400 hover:text-white">← 다른 영상 분석</Link><h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">영상 분석 작업 공간</h1></div><div className="flex flex-wrap items-center gap-2"><Badge>최대 30분</Badge><Badge>{quota?.enabled?'개인용 무료 AI':'AI 연결 준비 필요'}</Badge></div></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="space-y-4 lg:sticky lg:top-5">
        <Card className="overflow-hidden">{valid?<YouTubePlayerEmbed ref={playerRef} videoId={videoId} durationSeconds={video?.durationSeconds}/>:<p className="p-6">잘못된 영상 ID</p>}<div className="p-5"><h2 className="font-semibold leading-7">{video?.title||'영상 정보를 확인하는 중입니다'}</h2><p className="mt-1 text-sm text-slate-400">{video?.channel||'YouTube'} {video?.durationSeconds?`· ${timestamp(video.durationSeconds)}`:''}</p><a className="mt-3 inline-block text-xs text-indigo-300 hover:underline" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">YouTube에서 원본 보기 ↗</a></div></Card>
        <Card className="p-5"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">분석 상태</h3><Badge>{failure?'오류':phase==='completed'&&record?.analysisMeta?.qualityStatus==='partial'?'부분 분석':({checking:'조회 중',ready:'준비',processing:'분석 중',completed:'완료',error:'오류'})[phase]}</Badge></div>
        {failure&&<div role="alert" className="mt-3 rounded-xl border border-rose-700/50 bg-rose-950/30 px-3 py-3 text-sm leading-6 text-rose-200"><strong className="block font-semibold">분석을 완료하지 못했습니다</strong>{failure}</div>}
        {!failure&&<p role="status" className="mt-3 text-sm leading-7 text-slate-400">{message||(phase==='completed'?'분석 결과를 현재 화면에서 확인할 수 있습니다. 이동·새로고침 시 사라지므로 다운로드하세요.':phase==='ready'?(autoAnalyze&&!autoAttempted?'영상 확인 완료 · AI 분석을 자동으로 시작합니다.':'영상 정보를 확인했습니다. 분석 시작 버튼을 눌러주세요.'):'입력 자료와 서버 설정을 확인합니다.')}</p>}
        {phase==='processing'&&<div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex items-center gap-3"><span aria-hidden="true" className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-300/25 border-t-indigo-300"/><div className="min-w-0 flex-1"><p className="text-sm font-medium text-indigo-100">{progress?.label||'분석 준비 중'}</p><p className="mt-1 text-xs text-slate-400">경과 {Math.floor(elapsed/60)}분 {String(elapsed%60).padStart(2,'0')}초 {progress?.attempt?`· API 요청 ${progress.attempt}회차`:''}</p></div><span className="text-sm font-semibold tabular-nums text-indigo-200">{stagePercent(progress?.step??0)}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="분석 작업 단계 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stagePercent(progress?.step??0)}><div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{width:`${stagePercent(progress?.step??0)}%`}}/></div>
          <p className="text-xs leading-5 text-slate-500">표시된 %는 영상 확인·응답 수신 등 완료된 <strong>작업 단계 기준</strong>입니다. Gemini 내부 분석률은 확인할 수 없으며 분석 중 수치가 유지될 수 있습니다.</p>
          <Button type="button" variant="secondary" className="w-full" onClick={stop}>진행 중인 분석 중단</Button>
        </div>}
        {phase!=='processing'&&!(autoAnalyze&&!autoAttempted&&phase==='ready')&&<Button className="mt-4 w-full" onClick={begin} disabled={!video||phase==='checking'||phase==='error'}>{record?'다시 분석 (무료 요청)':'분석 시작'}</Button>}
        {record&&<p className="mt-3 text-xs text-slate-500">분석을 새로 시작하면 현재 결과가 교체됩니다. 필요한 내용은 먼저 다운로드해주세요.</p>}</Card>
      </div>
      <Card className="min-w-0 overflow-hidden"><div className="border-b border-slate-800 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">분석 결과</h2><p className="mt-1 text-xs text-slate-500">한국어 · 근거 연결 · 상세 해설 · 저장 없음</p></div>{record&&<Badge>{changed?'사용자 편집본':'AI 원본'}</Badge>}</div>{record?.analysisMeta&&<p className="mt-2 text-xs text-slate-400">{record.analysisMeta.depth==='deep'?'정밀 분석':'기본 분석'} · {record.model} · 실제 무료 AI 호출 {record.analysisMeta.providerCalls}회{record.analysisMeta.composeRecovery==='article-only'?' · 아티클 전용 복구/보강(요약·타임라인은 일부 근거 메모)':record.analysisMeta.refinement==='improved'?' · 근거 추출 → 상세 문서 완성':record.analysisMeta.refinement==='kept-first'?' · 문서 생성 실패: 근거 요지만 제공':''}{record.analysisMeta.sourceClaims?` · 추출된 논점 ${record.analysisMeta.sourceClaims}개`:''}{record.analysisMeta.sourceMode==='user-captions'?' · 사용자 자막 기반':record.analysisMeta.sourceMode==='public-captions'?' · 공개 YouTube 자막 기반':''}{record.analysisMeta.videoProcessing?` · 입력: ${record.analysisMeta.videoProcessing}`:''}{typeof record.analysisMeta.elapsedMs==='number'?` · AI 처리 ${(record.analysisMeta.elapsedMs/1000).toFixed(1)}초`:''}{typeof record.analysisMeta.inputTokens==='number'?` · 입력 토큰 ${record.analysisMeta.inputTokens.toLocaleString('ko-KR')}`:''}{typeof record.analysisMeta.outputTokens==='number'?` · 출력 토큰 ${record.analysisMeta.outputTokens.toLocaleString('ko-KR')}`:''}{record.analysisMeta.qualityStatus==='partial'?' · 부분 분석(원본 확인 필요)':''}{typeof record.analysisMeta.coveragePercent==='number'?` · 근거 참조율 ${record.analysisMeta.coveragePercent}%`:''}</p>}{record?.analysisMeta?.sourceMode==='public-captions'&&<p className="mt-1 text-xs text-slate-400">자막 기본 정리 {record.analysisMeta.captionLocalCorrections??0}건 · Gemini 문맥 교정 {record.analysisMeta.captionProofreadAccepted??0}건{record.analysisMeta.captionProofreadStatus==='failed'?` · 교정 실패: ${record.analysisMeta.captionProofreadCode??'UNKNOWN'}`:record.analysisMeta.captionProofreadStatus==='skipped'?' · AI 교정 생략':record.analysisMeta.captionProofreadStatus==='unchanged'?' · 추가 교정 없음':''}</p>}{record?.analysisMeta?.qualityStatus==='partial'&&<div role="status" className="mt-3 space-y-1 rounded-lg border border-amber-600/40 bg-amber-950/20 px-3 py-3 text-xs leading-6 text-amber-200"><p className="font-semibold">{(record.analysisMeta.sourceMode==='public-captions'||record.analysisMeta.sourceMode==='user-captions')?'시간 지정 자막은 확보했지만 AI 문서 생성이 불완전합니다.':'발언 원문 또는 상세 문서의 일부가 누락됐습니다.'}</p><p>{record.analysisMeta.refinement==='kept-first'?'AI 문서 생성에 실패했습니다. 확보된 자막이 있다면 시간순 원문 문단으로 표시하며, AI가 쓴 완성 아티클은 아닙니다.':'내용이 짧거나 영상 후반부까지 충분히 다루지 못했습니다. 내용이 많아 보여도 실제 원본 영상 대조가 필요합니다.'}</p>{typeof record.analysisMeta.sourceEndPercent==='number'&&<p>마지막 근거 구간 종료 시점: 영상의 약 {record.analysisMeta.sourceEndPercent}% · 내용 확인률이 아닙니다.</p>}{record.analysisMeta.composeFailureCode&&<p>상세 문서 생성 단계 오류: {record.analysisMeta.composeFailureCode}</p>}<p>{(record.analysisMeta.sourceMode==='public-captions'||record.analysisMeta.sourceMode==='user-captions')?'확보된 시간 지정 자막을 기준으로 결과를 보존했습니다. 자막 자체의 오인식이나 누락은 실제 음성과 대조해야 합니다.':'시간 지정 SRT/VTT 원문을 제공하면 누락 여부를 더 정확하게 확인할 수 있습니다.'}</p></div>}<div className="mt-4"><Tabs value={tab} onChange={v=>{setTab(v as Tab);setEditing(false)}} items={labeledTabs}/></div></div>
        <div className="min-h-[350px] p-4 sm:p-6">{warning&&<div role="alert" className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 text-sm text-amber-200">{warning}</div>}
        {record&&density&&density.shortFields.length>0&&<div className="mb-5 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-xs leading-6 text-slate-300"><p className="font-semibold text-slate-100">영상 정보에 비해 분석이 간략할 수 있습니다</p><p className="mt-1">{density.shortFields.join(' · ')} 항목이 적거나 설명이 짧습니다. 실제 영상의 확인 가능한 발화가 적거나 AI 출력이 간결했을 수 있습니다. 짧은 영상은 각 구간의 발언을 별도 요청으로 확인하지만, 원본에서 확인되지 않은 내용은 생성하지 않습니다.</p></div>}
        {!record?<div className="flex min-h-[310px] flex-col items-center justify-center text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 text-3xl text-indigo-300">{phase==='processing'?<span aria-hidden="true" className="h-9 w-9 animate-spin rounded-full border-[3px] border-indigo-300/20 border-t-indigo-300"/>:'✦'}</div><h3 className="text-lg font-semibold">{phase==='processing'?'AI가 영상을 분석하고 있습니다':'아직 분석 결과가 없습니다'}</h3><p className="mt-3 max-w-sm text-sm leading-7 text-slate-400">{phase==='processing'?'진행 상태와 경과 시간을 왼쪽 패널에서 확인할 수 있습니다. 분석 중에는 이 화면을 유지해주세요.':'메인에서 분석 시작을 누르면 추가 설정 없이 자동 분석합니다. 원본 영상에서 확인되지 않은 발언은 임의로 채우지 않습니다.'}</p></div>:
        <><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{selected.length}개 항목 {tab==='transcript'?'· 원문 확보 시에만 제공':''}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>{setEditing(x=>!x);toast.info(editing?'편집을 종료했습니다.':'편집 모드가 활성화됐습니다.',{description:'변경 내용은 현재 화면에만 유지됩니다.'});}}>{editing?'편집 종료':'편집'}</Button><Button variant="ghost" onClick={reset} disabled={!changed}>원본 복원</Button><Button variant="ghost" onClick={copy}>복사</Button></div></div>
        {record&&tab==='timeline'&&timeReview&&<div role="status" className="mb-5 rounded-xl border border-indigo-500/25 bg-indigo-950/20 p-4 text-xs leading-6 text-slate-300">
          <p className="font-semibold text-indigo-200">{timedFromCaptions?'시간 지정 자막 문장·시각 그대로 보존':'AI 생성 발언 초안 · 추정 시각'}</p>
          <p>{timedFromCaptions?'읽기 모드에서는 이어지는 자막을 문장 단위로 연결합니다. 원본 자막과 시간 정보는 보존되며, 표시된 시간은 원본 구간의 시작 시각입니다. 실제 음성과 대조해주세요.':'영상 URL만으로 생성된 시각과 발언 텍스트는 AI 초안입니다. 실제 녹취를 보증하지 않습니다. 시간 버튼으로 재생해 비교하거나 시간 지정 원문을 입력하면 문장과 시간을 그대로 보존합니다.'}</p>
          {timeReview.gaps.length>0&&<p className="mt-1 text-amber-200">시간 근거가 비어 보이는 구간: {timeReview.gaps.map(gap=>`${timelineTime(gap.from)}–${timelineTime(gap.to)} (${gap.seconds}초)`).join(' · ')}. 이 구간에 실제 발언이 없는지는 알 수 없습니다.</p>}
          {timeReview.hasSparseEnding&&<p className="mt-1 text-amber-200">마지막 시간 근거 종료: {timeReview.lastEndSeconds===null?'없음':timelineTime(timeReview.lastEndSeconds)} / 영상 종료: {timelineTime(record.video.durationSeconds)}. 영상 마지막 구간에 실제 발언이 있는지는 확인이 필요합니다. 마지막 행의 시작 시각만으로 누락을 단정하지 않습니다.</p>}
        </div>}
        {selected.length===0?<div className="rounded-xl border border-dashed border-slate-700 p-8 text-sm leading-7 text-slate-400">{tab==='transcript'?'원문 전사를 확보하지 못해 정확한 스크립트를 제공할 수 없습니다.':tab==='article'&&record.analysisMeta?.refinement==='kept-first'?'상세 아티클 생성에 실패했습니다. 근거 메모를 아티클로 복사하지 않습니다.':'검증 가능한 근거를 확보하지 못해 이 영역은 비어 있습니다.'}</div>:<DetailedAnalysisList tab={tab} items={selected} evidence={record.evidence} editing={editing} onSeek={seek} onTextChange={(id,text)=>changeItem(tab,id,text)} onTitleChange={(id,title)=>changeTitle(tab as 'summary'|'timeline'|'article',id,title)} onTimeEdit={editTimelineTime} timeSource={timedFromCaptions?'captions':'ai'}/>}
        {(record.edited.exclusions.length>0||editing)&&<div className="mt-6 rounded-xl border border-amber-700/40 bg-amber-900/10 p-4"><h3 className="text-sm font-semibold text-amber-200">분석 범위 및 확인이 필요한 구간</h3>{editing?<textarea aria-label="분석에서 제외된 내용 편집" className="mt-3 min-h-24 w-full rounded-lg border border-amber-800 bg-slate-950 p-3 text-xs leading-6 text-amber-100 focus:outline-none" value={record.edited.exclusions.join('\n')} onChange={e=>changeExclusions(e.target.value)}/>:<ul className="mt-2 list-inside list-disc text-xs leading-6 text-amber-100/80">{record.edited.exclusions.map((s,i)=><li key={i}>{s}</li>)}</ul>}</div>}
        <div className="mt-6 border-t border-slate-800 pt-5"><p className="text-xs text-slate-500" role="status">{notice||'영구 저장하지 않습니다. 새로고침·페이지 이동 시 결과가 사라집니다.'}</p><h3 className="mt-4 mb-3 text-sm font-semibold">전체 결과 다운로드</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('md')}>Markdown</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('txt')}>TXT</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('pdf')}>PDF</Button><Button variant="secondary" disabled={busyExport} onClick={()=>exportTo('docx')}>Word</Button></div><p className="mt-3 text-xs leading-6 text-slate-500">다운로드는 편집본 기준입니다. PDF는 한국어 표시를 위해 페이지 이미지를 사용하므로 본문을 텍스트로 선택할 수 없습니다.</p></div></>}
        </div></Card>
    </div>
  </main>
}
