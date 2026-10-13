import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
import { FREE_MODEL, type FreeModelId } from '@/lib/free-models';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import { googleErrorDetail,googleErrorMessage } from '@/lib/server/google-error';
import { assessDetail, detailTargets } from '@/lib/analysis-detail';
import { parseSourceMap, extractComposedContent, fallbackFromSource, sourceMapPrompt, composePrompt, sourceResponseFormat, composedResponseFormat, articleOnlyRecoveryPrompt, articleOnlyResponseFormat, recoverArticleFromSource, focusedTailPrompt, mergeFocusedTail } from '@/lib/server/evidence-pipeline';
import { sourceFromUserCaptions } from '@/lib/server/caption-source';
import { assessSourceCoverage, assessSinglePassCoverage, includeMissingCaptionTimeline } from '@/lib/quality-audit';
import { timelineFromSourceClaims, timelineFromEvidenceNotes, appendUnreferencedEvidenceNotes } from '@/lib/timeline-granularity';
import {coverageWindows,hasLateAnchors,missingEvidenceWindows} from '@/lib/temporal-coverage';
import {resolveVideoProcessing, type VideoProcessingMode, type VideoProcessingPreference} from '@/lib/video-processing';
// Single-call, source-grounded editorial instructions. Detail varies with video length;
// targets are aspirational and must never override source accuracy.
const prompt = `역할: 영상의 발언을 순서대로 정리하는 전문 한국어 기록 편집자.
우선순위: **시청자가 영상을 보지 않아도 모든 논점과 비교·사례·경고를 이해하도록 빠짐없이 기록**한다. 길게 쓰는 척하기 위해 영상에 없는 내용은 추가하지 않는다.

작업 규칙:
1. **먼저 영상 후반 50~100%를 살펴 새로운 발언·비교·예시·결론을 기록한 다음**, 처음으로 돌아와 0~25%,25~50%,50~75%,75~100% 전 구간을 순서대로 정리한다. 특히 영상 끝부분까지 논점이 바뀌는지 확인한다. 초반 개념에 출력 토큰을 소진하지 않는다.
2. **타임라인은 문장/의미 전환마다 하나씩** 만든다. 한 문단에 정의·비유·원인·사례·증상·구별법을 합치지 않는다. 3~5분 정보 중심 영상은 충분한 발언이 실제 있으면 약 10~16개를 목표로 한다. 시간 근거 하나당 확인 가능한 핵심 발언 한 개만 1~2문장으로 기록한다. 시점을 임의로 배분하지 않고 각 항목의 evidenceIds에 실제 그 발언이 시작한 근거를 연결한다. 00:33과 00:49에 서로 다른 발언이 있으면 두 개 항목으로 나눈다. 확인할 수 있는 근거가 없으면 숫자를 맞추려고 채우지 않는다.
2-1. evidence[]는 가능한 한 발언 하나당 하나의 좁은 실제 구간을 만들고 note에는 **그 구간에 해당하는 구체적인 발언 내용**을 1문장으로 적는다. 여러 다른 시점을 하나의 evidence에 합치지 않는다. 이를 확인할 수 없으면 세부 시간을 추측하지 말고 원래 확인된 넓은 구간을 사용한다.
3. summary는 타임라인의 세부 논점을 논리별로 묶은 **서로 다른 요점 3~6개**로 구성한다. 각 요점은 고유한 주장 + 영상의 이유 또는 구체적인 사례를 2~3문장으로 쓴다.
4. article은 한 줄씩 복사한 항목집이 아니라 영상 원문을 토대로 이어지는 **설명형 완성 아티클**이다. 실제 확인한 (a) 정의·비유 (b) 원인 및 다른 가능성 (c) 사례 (d) 증상과 혼동하기 쉬운 내용의 차이 (e) 화자의 결론 중 영상에 나온 소재만 사용해 3~6개의 의미 있는 소제목으로 나눈다. 항목별 본문은 실제 정보가 있으면 여러 개의 자연스러운 문단으로 쓰고 같은 문장을 반복하지 않는다.
5. 모든 summary·timeline·article 항목에 evidenceIds를 연결한다. 존재하는 영상의 실제 발언 시간만 적고 없거나 불확실한 시간·수치·주장을 만들지 않는다. 발표자의 의학적·통계적 주장과 별도로 검증된 과학적 사실을 구분한다.
6. transcript는 발언을 정확하게 전사했다고 확신할 때만 제공한다. 원문 확인이 불가능하면 []이고 생성한 해설을 발화문으로 둔갑시키지 않는다.
7. 타임라인은 영상의 4개 구간을 독립적으로 검토하고, 구간마다 실제 발언된 새 정보가 있다면 반드시 기록한다. 마지막 구간의 발언을 확인할 수 없다면 exclusions에 남기고 시간을 지어내지 않는다.
8. 출력은 제공된 JSON Schema를 지키는 한국어 JSON 한 개. 문서가 너무 짧아질 것 같으면 근거가 있는 타임라인 논점과 증상/차이점/결론의 누락을 우선 방지한다.
`;
export type InteractionResponse = {
  steps?: Array<{type?:string; content?:Array<{type?:string;text?:string}>}>;
  output_text?: string;
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
  status?: string;
  id?: string;
  error?: { code?: string; message?: string };
};
export function extractInteractionText(data: InteractionResponse): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const final = [...(data.steps || [])].reverse().find(step => step.type === 'model_output');
  return final?.content?.filter(part => part.type === 'text').map(part => part.text || '').join('') || '';
}
function string(v:unknown,max=12000){return typeof v==='string'?v.slice(0,max):'';}
function seconds(v:unknown,limit:number){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=limit?v:NaN;}
function convert(raw:unknown,video:VideoInfo,model:string):AnalysisRecord{
  if(!raw||typeof raw!=='object')throw new ServiceError('INVALID_RESULT','AI가 올바른 분석 데이터를 생성하지 못했습니다.',502);
  const object=raw as Record<string,unknown>;
  const ev:Array<Evidence>=Array.isArray(object.evidence)?object.evidence.flatMap((x:unknown,i)=>{
    const v=(x||{}) as Record<string,unknown>,start=seconds(v.startSeconds,video.durationSeconds),end=seconds(v.endSeconds,video.durationSeconds);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return [];
    return [{id:string(v.id,40)||`ev${i+1}`,startSeconds:start,endSeconds:end,kind:v.kind==='caption'?'caption':v.kind==='audio'?'audio':'video',note:string(v.note,500)} as Evidence];
  }):[];
  const validIds=new Set(ev.map(e=>e.id));if(ev.length===0||validIds.size!==ev.length)throw new ServiceError('INVALID_RESULT','영상 근거 데이터를 검증할 수 없습니다.',502);
  function items(input:unknown,key:string):GroundedItem[]{if(!Array.isArray(input))return [];return input.slice(0,100).flatMap((x:unknown,i)=>{const v=(x||{}) as Record<string,unknown>;const evidenceIds=Array.isArray(v.evidenceIds)?v.evidenceIds.filter((id:unknown)=>typeof id==='string'&&validIds.has(id)):[];const text=string(v.text);if(!text.trim()||evidenceIds.length===0)return [];return [{id:`${key}${i}`,title:string(v.title,180),text,evidenceIds}];});}
  const transcript:TranscriptLine[]=Array.isArray(object.transcript)?object.transcript.slice(0,1600).flatMap((x:unknown,i)=>{const v=(x||{}) as Record<string,unknown>,start=seconds(v.startSeconds,video.durationSeconds),end=seconds(v.endSeconds,video.durationSeconds);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||!string(v.text).trim())return [];return [{id:`tr${i}`,startSeconds:start,endSeconds:end,text:string(v.text,1500),translated:v.translated===true}];}):[];
  const content:AnalysisContent={summary:items(object.summary,'s'),timeline:items(object.timeline,'t'),article:items(object.article,'a'),transcript,exclusions:Array.isArray(object.exclusions)?object.exclusions.map(v=>string(v,400)).filter(Boolean).slice(0,30):[]};
  if(!content.summary.length||!content.timeline.length||!content.article.length)throw new ServiceError('INVALID_RESULT','검증 가능한 핵심 결과를 확보하지 못했습니다.',502);
  const now=new Date().toISOString();return {id:crypto.randomUUID(),video,createdAt:now,updatedAt:now,model,evidence:ev,original:content,edited:structuredClone(content)};
}
function decodeJson(value: string) {
  const data = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(data) as unknown;
}

// One-call schema retained for standard mode.
// No extra React/editor format conversion.
const analysisFormat = {
            type: 'text', mime_type: 'application/json',
            schema: {
              type: 'object',
              properties: {
                evidence: { type: 'array', description: '서로 다른 발언마다 실제 확인한 좁은 시간 구간과 구체적인 근거 노트를 기록. 모르는 시각은 추측 금지.', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, kind: {type: 'string'}, note: {type: 'string'}}, required: ['id','startSeconds','endSeconds','kind','note'] } },
                summary: { type: 'array', description: '핵심 주장별 분리된 상세 요약 목록. 각 text는 여러 문장.', items: { type: 'object', properties: {id: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','text','evidenceIds'] } },
                timeline: { type: 'array', description: '실제 발언의 의미가 바뀌는 시점마다 한 항목. 하나의 사실/발언만 1~2문장, 개별 근거시간 연결. 서로 다른 시점을 하나로 묶지 말 것.', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                article: { type: 'array', description: '긴 호흡의 해설 문서: 소제목별 여러 문단을 개행 두 번으로 구분.', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                transcript: { type: 'array', description: '실제 원문 발화를 확인한 경우에만 작성. 확인 불가시 빈 배열.', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, text: {type: 'string'}, translated: {type: 'boolean'}}, required: ['id','startSeconds','endSeconds','text','translated'] } },
                exclusions: {type: 'array', items: {type: 'string'}},
              }, required: ['evidence','summary','timeline','article','transcript','exclusions'],
            },
          };


const transientHttp = new Set([408, 500, 502, 503, 504]);
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message));
}
async function interaction(args:{key:string;model:FreeModelId;input:Array<{type:'text';text:string}|{type:'video';uri:string;processing?:VideoProcessingMode}>;format:unknown;signal?:AbortSignal;timeoutMs:number;requestId:string;pass:string;thinkingLevel?:'low'|'medium';maxOutputTokens?:number}) {
  const timeout=AbortSignal.timeout(args.timeoutMs);
  const signal=args.signal?AbortSignal.any([args.signal,timeout]):timeout;
  const started=Date.now();
  const processing=args.input.find(part=>part.type==='video')?.processing ?? 'text-only';
  console.info(JSON.stringify({event:'ai.request_started',requestId:args.requestId,model:args.model,pass:args.pass,processing,thinkingLevel:args.thinkingLevel??(args.model==='gemini-3.8-flash'?'medium':'low'),maxOutputTokens:args.maxOutputTokens??16000}));
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':args.key},
    cache:'no-store',signal,
    body:JSON.stringify({model:args.model,store:false,input:args.input,generation_config:{max_output_tokens:args.maxOutputTokens??16000,thinking_level:args.thinkingLevel??(args.model==='gemini-3.8-flash'?'medium':'low')},response_format:args.format}),
  });
  if(!response.ok){
    const detail=googleErrorDetail(await response.text().catch(() => ''));
    console.error(JSON.stringify({event:'ai.http_error',requestId:args.requestId,model:args.model,pass:args.pass,httpStatus:response.status,providerReason:detail.code,ms:Date.now()-started}));
    const msg=googleErrorMessage(response.status,detail);
    if(response.status===429)throw new ServiceError('FREE_LIMIT',msg,429);
    if([400,401,403,404].includes(response.status))throw new ServiceError('GOOGLE_REQUEST_REJECTED',msg,502);
    if(!transientHttp.has(response.status))throw new ServiceError('PROVIDER_UNAVAILABLE',msg,502);
    throw new ServiceError('TEMPORARY_HTTP',msg,502);
  }
  const data=await response.json() as InteractionResponse;
  if(data.status && data.status!=='completed')throw new ServiceError('INTERACTION_STATUS',`Gemini 응답 상태: ${data.status}. 완료된 결과를 받지 못했습니다.`,502);
  const output=extractInteractionText(data);
  if(!output.trim())throw new ServiceError('INVALID_RESULT','Gemini 분석 결과가 비어 있습니다.',502);
  let parsed:unknown;
  try { parsed=decodeJson(output); }catch{throw new ServiceError('INVALID_RESULT',`${args.pass}: Gemini가 유효한 JSON을 생성하지 못했습니다.`,502);}
  const tokens={input:data.usage?.total_input_tokens??null,output:data.usage?.total_output_tokens??null};
  const ms=Date.now()-started;
  console.info(JSON.stringify({event:'ai.request_completed',requestId:args.requestId,model:args.model,pass:args.pass,processing,ms,inputTokens:tokens.input,outputTokens:tokens.output}));
  return {parsed,tokens,ms};
}
function recordFromContent(video:VideoInfo,model:string,evidence:Evidence[],content:AnalysisContent):AnalysisRecord {
  const now=new Date().toISOString();
  return {id:crypto.randomUUID(),video,createdAt:now,updatedAt:now,model,evidence,original:content,edited:structuredClone(content)};
}
async function deepAnalysis(video:VideoInfo,model:FreeModelId,key:string,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,captionText?:string,videoProcessing:VideoProcessingMode='static'):Promise<AnalysisRecord>{
  // Source extraction is the expensive video-bearing request. Most analyses
  // use exactly two provider calls (video + text). On transient 5xx/timeouts,
  // retry ONLY this step once, retaining the user-selected model. In that case
  // deep mode uses at most three calls; never auto-switch to a paid model.
  const analysisStarted=Date.now();
  let stage1: Awaited<ReturnType<typeof interaction>> | null = null;
  let sourceCalls = 0;
  const provided = captionText?.trim() ? sourceFromUserCaptions(captionText,video) : null;
  let source: ReturnType<typeof parseSourceMap>;
  if(provided){
    // Trusted timed transcript is already an evidence ledger. Do not pay for
    // a redundant preliminary text-model extraction; compose in ONE API call.
    source=provided;
    onProgress({type:'progress',step:2,label:'시간 지정 원문 확인',detail:`사용자가 제공한 ${provided.evidence.length}개 원문 구간을 확보했습니다. 영상 재요청 없이 문서를 작성합니다.`});
  }else{
    for(let retry=0;retry<2;retry++){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      sourceCalls++;
      onProgress({type:'progress',step:2,attempt:sourceCalls,label:retry===0?'1/2 · 영상 근거 추출':'1/2 · 영상 근거 추출 재시도',detail:retry===0?'영상 처음부터 끝까지 발언·사례·차이점·결론 근거를 추출합니다.':'일시적인 Google 오류로 잠시 기다린 뒤 한 번만 재시도합니다.'});
      try{
        stage1=await interaction({key,model,requestId,pass:'source-map',format:sourceResponseFormat,input:[{type:'video',uri:video.url,processing:videoProcessing},{type:'text',text:sourceMapPrompt(video.durationSeconds)}],signal,timeoutMs:125000,thinkingLevel:'low'});
        break;
      }catch(error){
        if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
        const converted=isTimeout(error)?new ServiceError('TIMEOUT','영상 근거 추출 시간이 초과됐습니다.',504):error;
        const retryable=converted instanceof ServiceError && ['TEMPORARY_HTTP','TIMEOUT'].includes(converted.code);
        if(retry===0 && retryable){
          console.warn(JSON.stringify({event:'analysis.source_retry_scheduled',requestId,model,code:converted.code}));
          await new Promise<void>(resolve=>setTimeout(resolve,1400));
          continue;
        }
        if(converted instanceof ServiceError && converted.code==='TEMPORARY_HTTP')throw new ServiceError('PROVIDER_TEMPORARY',`선택한 ${model} 모델의 영상 입력 처리에서 Google 서버 오류가 ${sourceCalls}회 발생했습니다. 다른 무료 모델을 수동으로 선택할 수 있습니다. 자동 유료 전환은 하지 않습니다. 마지막 오류: ${converted.message}`,502);
        throw converted;
      }
    }
    if(!stage1)throw new ServiceError('PROVIDER_UNAVAILABLE','영상에서 근거를 확보하지 못했습니다.',502);
    try{source=parseSourceMap(stage1.parsed,video);}
    catch(error){throw new ServiceError('INVALID_SOURCE_MAP',error instanceof Error?error.message:'영상 근거 추출에 실패했습니다.',502);}
    // Explicit deep mode can spend one extra free video call only when the
    // first source map contains no late-video anchor. If it fails, preserve
    // the first source map and never invent late facts.
    if(!hasLateAnchors(source.evidence,video.durationSeconds)){
      onProgress({type:'progress',step:2,attempt:sourceCalls+1,label:'영상 후반부 근거 보완',detail:'첫 추출에서 후반부 발언이 빠져 정밀 모드에서만 영상 마지막 구간을 한 번 더 확인합니다. 무료 요청 1회가 추가됩니다.'});
      sourceCalls++;
      try{
        const extra=await interaction({key,model,requestId,pass:'tail-scan',format:sourceResponseFormat,input:[{type:'video',uri:video.url,processing:videoProcessing},{type:'text',text:focusedTailPrompt(video.durationSeconds)}],signal,timeoutMs:100000,thinkingLevel:'low',maxOutputTokens:9000});
        const supplement=parseSourceMap(extra.parsed,video);
        const merged=mergeFocusedTail(source,supplement,video.durationSeconds);
        source=merged.source;
        console.info(JSON.stringify({event:'analysis.tail_scan',requestId,model,addedClaims:merged.added,sourceClaims:source.claims.length}));
      }catch(tailError){
        if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
        // Respect the user's free-tier hard stop: do not submit the next compose
        // request when Google has explicitly rejected quota for this project.
        if(tailError instanceof ServiceError && tailError.code==='FREE_LIMIT')throw tailError;
        console.warn(JSON.stringify({event:'analysis.tail_scan_unavailable',requestId,model,code:tailError instanceof ServiceError?tailError.code:'INVALID_SOURCE'}));
      }
    }
  }
  onProgress({type:'progress',step:3,attempt:sourceCalls+1,label:provided?'시간 지정 원문 · 상세 문서 작성 (1회)':'2/2 · 상세 문서 작성',detail:`AI가 ${source.claims.length}개 논점과 ${source.evidence.length}개 시간 근거를 추출했습니다. 근거에 연결된 상세 문서를 작성합니다.`});
  let content:AnalysisContent;
  let composed=false;
  let composeRecovery: 'article-only' | undefined;
  let composeFailureCode: string | undefined;
  let stage2tokens:null|{input:number|null;output:number|null}=null;
  let compositionCalls=0;
  try {
    compositionCalls++;
    const stage2=await interaction({key,model,requestId,pass:'compose',format:composedResponseFormat,input:[{type:'text',text:composePrompt(source,video.durationSeconds)}],signal,timeoutMs:125000});
    content=extractComposedContent(stage2.parsed,source);
    composed=true;
    stage2tokens=stage2.tokens;
  } catch(error) {
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
    composeFailureCode=error instanceof ServiceError?error.code:'INVALID_OR_TIMEOUT';
    console.warn(JSON.stringify({event:'analysis.compose_failed',requestId,model,code:composeFailureCode,message:error instanceof Error?error.message.slice(0,160):'unknown'}));
    content=fallbackFromSource(source);
    // A narrow article-only retry is easier for a provider to satisfy than a
    // three-document structured response. It uses text evidence, never a new video call.
    // Do not retry a quota, permissions, or cancellation error.
    const retryable=!provided && ['TEMPORARY_HTTP','TIMEOUT','INVALID_RESULT'].includes(composeFailureCode);
    if(retryable){
      onProgress({type:'progress',step:3,attempt:sourceCalls+2,label:'아티클 전용 복구 시도',detail:'전체 문서 요청이 실패해 더 작은 아티클 전용 요청을 한 번만 시도합니다. 무료 요청을 추가 사용합니다.'});
      try {
        compositionCalls++;
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,1000);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new ServiceError('CANCELLED','중단됨',499));},{once:true});});
        const recovery=await interaction({key,model,requestId,pass:'article-recovery',format:articleOnlyResponseFormat,
          input:[{type:'text',text:articleOnlyRecoveryPrompt(source,video.durationSeconds)}],signal,timeoutMs:90000,thinkingLevel:'low',maxOutputTokens:9000});
        content=recoverArticleFromSource(recovery.parsed,source);
        composed=true;
        composeRecovery='article-only';
        stage2tokens=recovery.tokens;
        console.info(JSON.stringify({event:'analysis.article_recovered',requestId,model,articleSections:content.article.length}));
      }catch(recoveryError){
        if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
        console.warn(JSON.stringify({event:'analysis.article_recovery_failed',requestId,model,code:recoveryError instanceof ServiceError?recoveryError.code:'INVALID_OR_TIMEOUT'}));
      }
    }
    if(!composed)onProgress({type:'progress',step:3,label:'상세 문서 생성 실패',detail:'제공자가 작성 요청을 처리하지 못해 근거 메모만 제공합니다. 재호출하지 않습니다.'});
  }
  // A successful response may still omit an article or provide only a stub.
  // Try one bounded article-only composition without discarding already good
  // summary/timeline sections; never call the video URL a second time.
  const minUsefulArticleChars=video.durationSeconds<=300?650:video.durationSeconds<=900?1100:1800;
  if(composed && !provided && !composeRecovery && content.article.reduce((n,x)=>n+x.text.trim().length,0)<minUsefulArticleChars){
    onProgress({type:'progress',step:3,attempt:sourceCalls+compositionCalls+1,label:'아티클 상세도 보강',detail:'아티클 분량이 부족해 근거만 사용하는 전용 작성 요청을 한 번 더 시도합니다. 무료 API 사용량이 추가됩니다.'});
    try {
      compositionCalls++;
      const recovery=await interaction({key,model,requestId,pass:'article-detail',format:articleOnlyResponseFormat,
        input:[{type:'text',text:articleOnlyRecoveryPrompt(source,video.durationSeconds)}],signal,timeoutMs:90000,thinkingLevel:'low',maxOutputTokens:9000});
      const alternative=recoverArticleFromSource(recovery.parsed,source).article;
      const existingChars=content.article.reduce((n,x)=>n+x.text.trim().length,0);
      const alternativeChars=alternative.reduce((n,x)=>n+x.text.trim().length,0);
      if(alternativeChars>existingChars){content={...content,article:alternative};composeRecovery='article-only';}
      console.info(JSON.stringify({event:'analysis.article_detail_review',requestId,existingChars,alternativeChars,improved:alternativeChars>existingChars}));
    }catch(detailError){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      console.warn(JSON.stringify({event:'analysis.article_detail_unavailable',requestId,code:detailError instanceof ServiceError?detailError.code:'INVALID_OR_TIMEOUT'}));
    }
  }
  // Restore atomic time-aligned claims when a composed timeline merged multiple
  // source moments into a single paragraph; no additional Gemini request.
  const timelineBefore = content.timeline.length;
  content = {...content, timeline: timelineFromSourceClaims(source.claims,source.evidence,content.timeline)};
  if(provided) content=includeMissingCaptionTimeline(source,content);
  console.info(JSON.stringify({event:'analysis.timeline_granularity',requestId,sourceMode:provided?'user-captions':'video-url',before:timelineBefore,after:content.timeline.length}));
  const audit=assessSourceCoverage(source,content,video.durationSeconds,composed);
  console.info(JSON.stringify({event:'analysis.time_coverage',requestId,model,depth:'deep',missingWindows:missingEvidenceWindows(source.evidence,video.durationSeconds),sourceCalls}));
  if(composeRecovery)audit.qualityStatus='partial';
  if(audit.sourceIncomplete) content.exclusions.push('시간 근거 분포가 제한적입니다. 영상 후반부의 핵심 발언이 누락되었는지는 원본과 대조해주세요.');
  if(composeRecovery)content.exclusions.push('복구된 아티클은 원본 근거를 사용했으나 요약·타임라인은 1차 근거 메모입니다. 전체 상세 분석으로 확정하지 않았습니다.');
  if(audit.articleIncomplete) content.exclusions.push(composed?'아티클이 상세도 기준에 미치지 못합니다. 근거만으로 충분한 설명을 생성하지 못했습니다.':'2차 아티클 생성 실패: 아티클은 제공하지 않고 1차 근거 메모만 보여줍니다.');
  if(audit.qualityStatus==='partial') content.exclusions.push('부분 분석으로 분류했습니다. 실제 영상과 대조하여 누락된 내용을 확인하세요.');
  const result=recordFromContent(video,model,source.evidence,content);
  result.analysisMeta={depth:'deep',videoProcessing:provided?'captions':videoProcessing,elapsedMs:Date.now()-analysisStarted,providerCalls:sourceCalls+compositionCalls,refinement:composed?'improved':'kept-first',pipeline:'evidence-compose',sourceClaims:source.claims.length,sourceEvidence:source.evidence.length, sourceMode:provided?'user-captions':'video-url', qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent,sourceEndPercent:audit.sourceEndPercent,articleChars:audit.articleChars,composeFailureCode,composeRecovery};
  onProgress({type:'progress',step:4,label:'근거 연결 검사 완료',detail:'존재하는 근거 ID·시간 범위를 확인했습니다. 사실 일치는 원본 대조가 필요합니다.'});
  const quality=assessDetail(content,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'deep',pipeline:'evidence-compose',providerCalls:sourceCalls+compositionCalls,sourceCalls,compositionCalls,composeRecovery:composeRecovery??null,composed,sourceClaims:source.claims.length,sourceEvidence:source.evidence.length,firstInputTokens:stage1?.tokens.input??null,firstOutputTokens:stage1?.tokens.output??null,secondTokens:stage2tokens,contentMetrics:quality.counts,shortFields:quality.shortFields,sourceMode:result.analysisMeta.sourceMode,qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent,sourceEndPercent:audit.sourceEndPercent,sourceBuckets:audit.sourceBuckets,articleChars:audit.articleChars,sourceIncomplete:audit.sourceIncomplete,articleIncomplete:audit.articleIncomplete,composeFailureCode:composeFailureCode??null}));
  return result;
}
export async function analyzeVideo(video:VideoInfo,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,depth:'standard'|'deep'='standard',model:FreeModelId=FREE_MODEL,captionText?:string,processingPreference:VideoProcessingPreference='auto'):Promise<AnalysisRecord>{
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new ServiceError('NOT_CONFIGURED','Google AI Studio 무료 등급 API 키가 필요합니다.',503);
  const videoProcessing=resolveVideoProcessing(video.durationSeconds,model,processingPreference);
  if(depth==='deep' || captionText?.trim())return deepAnalysis(video,model,key,requestId,onProgress,signal,captionText,videoProcessing);
  const analysisStarted=Date.now();
  const targets=detailTargets(video.durationSeconds);
  const windows=coverageWindows(video.durationSeconds).map((w,i)=>`${i+1}구간 ${w.label}`).join(' / ');
  const detailInstructions=`검토해야 할 실제 시간 구간: ${windows}. 후반부를 먼저 확인하되 최종 출력은 시작 시각 순서로 정렬할 것. 각 구간의 실제 발언을 따로 점검하고, 없던 발언을 새로 만들어 항목 수를 채우지 말 것.\n영상 ${video.durationSeconds}초: 근거가 충분하면 요약 ${targets.summary}개 이상, 타임라인 ${targets.timeline}개 이상, 아티클 소제목 ${targets.article}개 이상을 목표로 하되 근거 없는 내용은 절대 생성하지 마라.`;
  // Fast/basic mode: no silent second video pass after a 503/timeout.
  // The user can retry deliberately; deep mode retains its recovery policy.
  const attempts=[video.durationSeconds<300?90000:120000];let lastError:unknown;
  for(let i=0;i<attempts.length;i++){
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
    onProgress({type:'progress',step:2,attempt:i+1,label:'기본 영상 분석',detail:'영상에서 근거를 찾고 한국어 결과물을 생성하고 있습니다.'});
    try {
      const response=await interaction({key,model,requestId,pass:'standard',format:analysisFormat,input:[{type:'video',uri:video.url,processing:videoProcessing},{type:'text',text:prompt+'\n'+detailInstructions}],signal,timeoutMs:attempts[i],thinkingLevel:'low',maxOutputTokens:video.durationSeconds<300?12000:16000});
      const result=convert(response.parsed,video,model);
      const timelineBefore=result.original.timeline.length;
      result.original.timeline=appendUnreferencedEvidenceNotes(timelineFromEvidenceNotes(result.original.timeline,result.evidence),result.evidence);
      console.info(JSON.stringify({event:'analysis.timeline_granularity',requestId,sourceMode:'video-url',before:timelineBefore,after:result.original.timeline.length}));
      const audit=assessSinglePassCoverage(result.evidence,result.original,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.time_coverage',requestId,model,missingWindows:missingEvidenceWindows(result.evidence,video.durationSeconds),timelineCount:result.original.timeline.length}));
      result.analysisMeta={depth:'standard',videoProcessing,elapsedMs:Date.now()-analysisStarted,inputTokens:response.tokens.input??undefined,outputTokens:response.tokens.output??undefined,providerCalls:i+1,refinement:'not-needed',pipeline:'single-pass',qualityStatus:audit.incomplete?'partial':'review',sourceEndPercent:audit.lastTimelinePercent};
      if(audit.needsReview)result.original.exclusions.push(`타임라인을 원본과 대조해주세요(마지막 근거 구간 종료 시점: 영상의 약 ${audit.lastTimelinePercent}%). 이 값은 영상의 실제 내용 확인률이 아닙니다.`);
      result.edited=structuredClone(result.original);
      onProgress({type:'progress',step:4,label:'타임라인 전체 구간 검사',detail:audit.needsReview?'세부 발언의 시간 근거를 원본과 대조해주세요.':'타임라인 시간 분포와 근거 구조를 확인했습니다.'});
      const quality=assessDetail(result.original,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'standard',videoProcessing,elapsedMs:Date.now()-analysisStarted,providerCalls:i+1,tokens:response.tokens,contentMetrics:quality.counts,shortFields:quality.shortFields}));
      return result;
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
      lastError=isTimeout(error)?new ServiceError('TIMEOUT','영상 분석 시간이 초과됐습니다.',504):error;
      // Do not hide another long video request behind a single 'basic' click.
      break;
    }
  }
  throw lastError instanceof ServiceError?lastError:new ServiceError('PROVIDER_UNAVAILABLE',lastError instanceof Error?lastError.message:'분석 요청에 실패했습니다.',502);
}
