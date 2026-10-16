import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
import { FREE_MODEL, FREE_MODELS, type FreeModelId } from '@/lib/free-models';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import { googleErrorDetail,googleErrorMessage } from '@/lib/server/google-error';
import { assessDetail, detailTargets } from '@/lib/analysis-detail';
import { parseSourceMap, extractComposedContent, fallbackFromSource, sourceMapPrompt, composePrompt, sourceResponseFormat, composedResponseFormat, articleOnlyRecoveryPrompt, articleOnlyResponseFormat, recoverArticleFromSource, focusedTailPrompt, mergeFocusedTail } from '@/lib/server/evidence-pipeline';
import { sourceFromUserCaptions, timelineFromProvidedCaptions } from '@/lib/server/caption-source';
import {captionArticleFromEvidence} from '@/lib/server/caption-article-fallback';
import {freeTextFallbackModel} from '@/lib/server/free-text-fallback';
import { assessSourceCoverage, assessSinglePassCoverage } from '@/lib/quality-audit';
import { timelineFromSourceClaims, timelineFromEvidenceNotes, appendUnreferencedEvidenceNotes } from '@/lib/timeline-granularity';
import {coverageWindows,hasLateAnchors,missingEvidenceWindows} from '@/lib/temporal-coverage';
import {resolveVideoProcessing, type VideoProcessingMode, type VideoProcessingPreference} from '@/lib/video-processing';
import {assessTimelineTiming} from '@/lib/timeline-accuracy';
import { shouldRetryProviderBusy, waitBeforeProviderRetry, BUSY_RETRY_DELAY_MS, remainingBasicAnalysisMs, hasBasic503RetryBudget } from '@/lib/provider-retry';
import {speechReviewWindows, chooseSpeechRecoveryWindow, speechFirstTimeline, mergeSupplementalSpeech, dedupeInitialSpeech} from '@/lib/speech-timeline';
import {fetchPublicKoreanCaptions} from '@/lib/server/public-captions';
import {fetchYtDlpKoreanCaptions,preserveTimedCaptionTimeline,parseTimedCaptionSrt} from '@/lib/server/ytdlp-captions';
import {
  applyCaptionProofread,
  correctedLinesToSrt
} from '@/lib/server/caption-proofread';
import {
  captionOneCallFormat,
  captionOneCallPrompt
} from '@/lib/server/caption-one-call';
import {normalizeCaptionErrors} from '@/lib/server/caption-cleanup';
import {
  repairCaptionQuotationParticles,
  reconcileCaptionSource
} from '@/lib/server/caption-context-reconcile';

import {shortSpeechSegments,precisionSpeechSegments,clipVideoInputs,parseSegmentedSpeech} from '@/lib/segmented-speech';
import { readInteractionSse } from '@/lib/server/interaction-sse';
import {makeSpeechClipRequest,collectSpeechClipResults,speechSource,formatMissingWindows} from '@/lib/speech-clip-pipeline';
import {mergeSpeechSentences,largestSpeechGap} from '@/lib/speech-sentence-merge';
import {finalizeSpeechTimeline} from '@/lib/speech-finalize';
import {salvageRejectedSpeech,planSpeechRepairWindows,makeSpeechCoverageRequest,extractCoverageReviewRows,mergeIndependentCoverage} from '@/lib/speech-coverage-recovery';
import {chooseSpeechGapAudit,mergeGapAuditedLines,planSpeechClockAudit,makeSpeechClockAuditRequest,applySpeechClockAudit} from '@/lib/speech-audit';
import {speechClipFailureCode,shouldTryFreeModelFallback,SPEECH_PROBE_TIMEOUT_MS,SPEECH_CLIP_TIMEOUT_MS,SPEECH_FALLBACK_WAIT_MS} from '@/lib/speech-clip-recovery';
// Single-call, source-grounded editorial instructions. Detail varies with video length;
// targets are aspirational and must never override source accuracy.
const prompt = `역할: 영상의 발언을 순서대로 정리하는 전문 한국어 기록 편집자.
우선순위: **원문의 발언을 생략하지 않고 시간순으로 기록한 다음, 그 발언에서 요약과 아티클을 작성**한다. 길게 쓰는 척하기 위해 영상에 없는 내용은 추가하지 않는다.

작업 규칙:
1. **먼저 영상 후반 50~100%를 살펴 새로운 발언·비교·예시·결론을 기록한 다음**, 처음으로 돌아와 0~25%,25~50%,50~75%,75~100% 전 구간을 순서대로 정리한다. 특히 영상 끝부분까지 논점이 바뀌는지 확인한다. 초반 개념에 출력 토큰을 소진하지 않는다.
2. **타임라인은 음성 발언의 어순·말투를 최대한 유지하는 발언 중심 기록**이다. 요약·해설·의학적 보충설명·새로운 단정문을 만들지 않는다. 실제로 들은 표현만 사용하되, 정확한 원문이라고 보증할 수 없으므로 발언 시각과 내용은 모두 검증 전 초안으로 취급한다. **문장/의미 전환마다 하나씩** 만든다. 한 문단에 정의·비유·원인·사례·증상·구별법을 합치지 않는다. 3~5분 정보 중심 영상은 충분한 발언이 실제 있으면 약 10~16개를 목표로 한다. 시간 근거 하나당 확인 가능한 핵심 발언 한 개만 1~2문장으로 기록한다. 시점을 임의로 배분하지 않고 각 항목의 evidenceIds에 실제 그 발언이 시작한 근거를 연결한다. 00:33과 00:49에 서로 다른 발언이 있으면 두 개 항목으로 나눈다. 확인할 수 있는 근거가 없으면 숫자를 맞추려고 채우지 않는다.
2-1. evidence[]는 가능한 한 발언 하나당 하나의 좁은 실제 구간을 만들고 note에는 **그 구간에서 들은 발언의 실제 어순과 말투에 가까운 문장**을 적는다. "설명한다", "강조한다", "사례를 제시한다" 같은 편집자 요약문을 피한다. 들리지 않는 어휘는 채우거나 의학 지식으로 보완하지 않는다. 여러 다른 시점을 하나의 evidence에 합치지 않는다. 이를 확인할 수 없으면 세부 시간을 추측하지 말고 원래 확인된 넓은 구간을 사용한다.
3. summary는 타임라인의 세부 논점을 논리별로 묶은 **서로 다른 요점 3~6개**로 구성한다. 각 요점은 고유한 주장 + 영상의 이유 또는 구체적인 사례를 2~3문장으로 쓴다.
4. article은 한 줄씩 복사한 항목집이 아니라 영상 원문을 토대로 이어지는 **설명형 완성 아티클**이다. 실제 확인한 (a) 정의·비유 (b) 원인 및 다른 가능성 (c) 사례 (d) 증상과 혼동하기 쉬운 내용의 차이 (e) 화자의 결론 중 영상에 나온 소재만 사용해 3~6개의 의미 있는 소제목으로 나눈다. 항목별 본문은 실제 정보가 있으면 여러 개의 자연스러운 문단으로 쓰고 같은 문장을 반복하지 않는다.
5. 모든 summary·timeline·article 항목에 evidenceIds를 연결한다. 존재하는 영상의 실제 발언 시간만 적고 없거나 불확실한 시간·수치·주장을 만들지 않는다. 발표자의 의학적·통계적 주장과 별도로 검증된 과학적 사실을 구분한다.
6. transcript는 이번 분석의 **최우선 산출물**이다. 실제 음성으로 들리는 한국어 발화 문장들을 가능한 한 그대로, 해당 발언이 시작되는 초와 끝나는 초를 연결해 기록한다. 3~5분 대화형 영상에서는 발언이 확인되면 15~40개의 문장·의미 전환을 가능한 한 유지하며, 특히 종료 1분의 발언도 먼저 확인한다. 00~25%,25~50%,50~75%,75~100%에 실제 발언이 있으면 모두 기록한다. transcript[].text는 요약·해설체("소개합니다", "강조합니다")가 아니라 화자가 말한 어휘·어순에 가까운 문장이다. 음성을 듣지 못한 구간을 만들거나 발언 시각을 균등 분할하여 지어내지 마라. 완전한 축자 녹취를 보장할 수 없으면 exclusions에서 명확히 밝혀라. transcript=[]는 유효한 발화를 전혀 확인하지 못한 경우에만 사용한다.
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
                evidence: { type: 'array', description: '영상 속 발언의 어순과 표현을 최대한 유지한 노트. 편집자의 요약/단정/의학 설명으로 바꿔 쓰지 말 것. 불명확한 시각은 추측 금지.', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, kind: {type: 'string'}, note: {type: 'string'}}, required: ['id','startSeconds','endSeconds','kind','note'] } },
                summary: { type: 'array', description: '핵심 주장별 분리된 상세 요약 목록. 각 text는 여러 문장.', items: { type: 'object', properties: {id: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','text','evidenceIds'] } },
                timeline: { type: 'array', description: '화자가 실제로 말한 표현에 가까운 1~2문장을 시간순으로. 요약형 제목이나 새 사실 추가 금지. 의미 전환마다 한 항목.', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                article: { type: 'array', description: '긴 호흡의 해설 문서: 소제목별 여러 문단을 개행 두 번으로 구분.', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                transcript: { type: 'array', description: '최우선 출력: 실제 들리는 발화에 가까운 문장과 시작/끝의 시각, 3~5분 영상에서 가능한 경우 15~40개. 초중후반과 마지막 발언까지; 요약문 금지. 확신할 수 없으면 추측 금지.', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, text: {type: 'string'}, translated: {type: 'boolean'}}, required: ['id','startSeconds','endSeconds','text','translated'] } },
                exclusions: {type: 'array', items: {type: 'string'}},
              }, required: ['evidence','summary','timeline','article','transcript','exclusions'],
            },
          };


/** In one free API request, ask separately about the three actual clipped
 * video inputs. Segment-relative utterance positions are translated locally. */
const segmentedAnalysisFormat={...analysisFormat,schema:{...analysisFormat.schema,
  properties:{...analysisFormat.schema.properties,segmentTranscripts:{type:'array',description:'각 입력된 영상 클립마다 한 객체. 0,1,2 순서로 구간을 각각 독립 전사하라.',items:{type:'object',properties:{segmentIndex:{type:'number'},lines:{type:'array',items:{type:'object',properties:{startSeconds:{type:'number'},endSeconds:{type:'number'},text:{type:'string'}},required:['startSeconds','endSeconds','text']}}},required:['segmentIndex','lines']}}},
  required:[...analysisFormat.schema.required,'segmentTranscripts']}};
const speechTailFormat={type:'text',mime_type:'application/json',schema:{type:'object',properties:{lines:{type:'array',items:{type:'object',properties:{startSeconds:{type:'number'},endSeconds:{type:'number'},text:{type:'string'}},required:['startSeconds','endSeconds','text']}}},required:['lines']}};
function focusedSpeechPrompt(duration:number,windows:Array<{from:number;to:number}>):string{
  const clock=(time:number)=>`${String(Math.floor(time/60)).padStart(2,'0')}:${String(Math.floor(time%60)).padStart(2,'0')}`;
  return `이 요청은 기존 영상 분석에서 누락된 **음성 발화만 회복**하기 위한 것이다. 같은 영상 전체를 다시 요약하지 말라.
영상 전체 길이 ${clock(duration)}. 다음 시간 구간에 실제 들리는 문장만 한 발언마다 lines 요소 하나로 기록한다:
${windows.map(w=>`- ${clock(w.from)}~${clock(w.to)}`).join('\n')}
각 lines[].text는 실제 음성의 어휘와 문장에 최대한 가까워야 한다. 제삼자 설명/주제 요약/질병 상식 추가/오디오 미확인 부분 보충/균등 시간 배분을 금지한다. 발언이 없는 구간은 빈 배열로 두고, 반드시 원래 영상의 실제 절대 시작·종료 초를 적는다. 해당 구간 밖의 발언은 한 줄도 포함하지 말라. 00:02 같은 초반 시각으로 후반 발언을 옮겨 적지 말라. 이번 응답은 lines JSON만 작성하라.`;
}
const transientHttp = new Set([408, 500, 502, 503, 504]);
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message));
}
async function interaction(args:{key:string;model:FreeModelId;input:Array<{type:'text';text:string}|{type:'video';uri:string;processing?:VideoProcessingMode | {type:'static';start_offset:string;end_offset:string}}>;format:unknown;signal?:AbortSignal;timeoutMs:number;requestId:string;pass:string;thinkingLevel?:'low'|'medium';maxOutputTokens?:number}) {
  const timeout=AbortSignal.timeout(args.timeoutMs);
  const signal=args.signal?AbortSignal.any([args.signal,timeout]):timeout;
  const started=Date.now();
  const processing=args.input.find(part=>part.type==='video')?.processing ?? 'text-only';
  // Streaming is stateless (store:false) and uses the same ONE Gemini request.
  // Do not enable Google background:true here: that requires store:true.
  const streamed=args.pass==='standard'||args.pass==='standard-segmented';
  console.info(JSON.stringify({event:'ai.request_started',requestId:args.requestId,model:args.model,pass:args.pass,processing,transport:streamed?'sse':'json',thinkingLevel:args.thinkingLevel??(args.model==='gemini-3.8-flash'?'medium':'low'),maxOutputTokens:args.maxOutputTokens??16000}));
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method:'POST',headers:{'Content-Type':'application/json','Accept':streamed?'text/event-stream':'application/json','x-goog-api-key':args.key},
    cache:'no-store',signal,
    body:JSON.stringify({model:args.model,store:false,stream:streamed,input:args.input,generation_config:{max_output_tokens:args.maxOutputTokens??16000,thinking_level:args.thinkingLevel??(args.model==='gemini-3.8-flash'?'medium':'low')},response_format:args.format}),
  }).catch(error=>{
    if(timeout.aborted && !args.signal?.aborted)throw new ServiceError('TIMEOUT','Gemini 응답 대기시간이 초과됐습니다.',504);
    throw error;
  });
  if(!response.ok){
    const detail=googleErrorDetail(await response.text().catch(() => ''));
    console.error(JSON.stringify({event:'ai.http_error',requestId:args.requestId,model:args.model,pass:args.pass,httpStatus:response.status,providerReason:detail.code,ms:Date.now()-started}));
    const msg=googleErrorMessage(response.status,detail);
    if(response.status===429)throw new ServiceError('FREE_LIMIT',msg,429);
    if(response.status===503)throw new ServiceError('PROVIDER_BUSY',`선택한 ${args.model} 모델이 현재 혼잡해 Google이 요청을 처리하지 못했습니다(HTTP 503). 잠시 후 다시 시도하거나 다른 무료 모델을 직접 선택해주세요. 유료 모델 자동 전환은 하지 않습니다.`,503);
    if([400,401,403,404].includes(response.status))throw new ServiceError('GOOGLE_REQUEST_REJECTED',msg,502);
    if(!transientHttp.has(response.status))throw new ServiceError('PROVIDER_UNAVAILABLE',msg,502);
    throw new ServiceError('TEMPORARY_HTTP',msg,502);
  }
  let output: string;
  let tokens: {input:number|null;output:number|null};
  if(streamed && response.headers.get('content-type')?.includes('text/event-stream')){
    const streamedResponse=await readInteractionSse(response).catch(error=>{
      if(timeout.aborted && !args.signal?.aborted)throw new ServiceError('TIMEOUT','Gemini 스트리밍 응답 대기시간이 초과됐습니다.',504);
      if(error instanceof Error && /RESOURCE_EXHAUSTED|rate.limit|quota.exceeded/i.test(error.message))throw new ServiceError('FREE_LIMIT','선택한 Gemini 모델의 무료 요청 한도가 초과됐습니다.',429);
      throw error;
    });
    output=streamedResponse.output;
    tokens={input:streamedResponse.inputTokens,output:streamedResponse.outputTokens};
    console.info(JSON.stringify({event:'ai.stream_completed',requestId:args.requestId,model:args.model,pass:args.pass,firstTextMs:streamedResponse.firstTextMs,chunks:streamedResponse.chunks,ms:Date.now()-started}));
  }else{
    // If a gateway returns a non-SSE JSON response, handle its body without
    // repeating the paid/free model call or silently changing models.
    const data=await response.json() as InteractionResponse;
    if(data.status && data.status!=='completed')throw new ServiceError('INTERACTION_STATUS',`Gemini 응답 상태: ${data.status}. 완료된 결과를 받지 못했습니다.`,502);
    output=extractInteractionText(data);
    tokens={input:data.usage?.total_input_tokens??null,output:data.usage?.total_output_tokens??null};
  }
  if(!output.trim())throw new ServiceError('INVALID_RESULT','Gemini 분석 결과가 비어 있습니다.',502);
  let parsed:unknown;
  try { parsed=decodeJson(output); }catch{throw new ServiceError('INVALID_RESULT',`${args.pass}: Gemini가 유효한 JSON을 생성하지 못했습니다.`,502);}
  const ms=Date.now()-started;
  console.info(JSON.stringify({event:'ai.request_completed',requestId:args.requestId,model:args.model,pass:args.pass,processing,ms,inputTokens:tokens.input,outputTokens:tokens.output}));
  return {parsed,tokens,ms};
}
function recordFromContent(video:VideoInfo,model:string,evidence:Evidence[],content:AnalysisContent):AnalysisRecord {
  const now=new Date().toISOString();
  return {id:crypto.randomUUID(),video,createdAt:now,updatedAt:now,model,evidence,original:content,edited:structuredClone(content)};
}
async function deepAnalysis(video:VideoInfo,model:FreeModelId,key:string,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,captionText?:string,videoProcessing:VideoProcessingMode='static',retryOnBusy=true):Promise<AnalysisRecord>{
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
        const retryable=converted instanceof ServiceError && (shouldRetryProviderBusy(converted.code,retry,retryOnBusy) || ['TEMPORARY_HTTP','TIMEOUT'].includes(converted.code));
        if(retry===0 && retryable){
          const busy=converted instanceof ServiceError && converted.code==='PROVIDER_BUSY';
          onProgress({type:'progress',step:2,attempt:sourceCalls+1,label:busy?'Google 503 · 재시도 대기':'Google 일시 오류 · 재시도 대기',detail:`${busy?'서버 혼잡으로':'일시적인 오류로'} 잠시 대기한 뒤 동일한 무료 모델로 한 번만 재시도합니다. (${busy?BUSY_RETRY_DELAY_MS:1400}ms)`});
          console.warn(JSON.stringify({event:'analysis.source_retry_scheduled',requestId,model,code:converted instanceof ServiceError?converted.code:'UNKNOWN'}));
          await waitBeforeProviderRetry(signal,busy?BUSY_RETRY_DELAY_MS:1400);
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
  let finalModel:FreeModelId=model;
  try {
    compositionCalls++;
    const stage2=await interaction({key,model,requestId,pass:'compose',format:composedResponseFormat,input:[{type:'text',text:composePrompt(source,video.durationSeconds)}],signal,timeoutMs:provided?70000:125000});
    content=extractComposedContent(stage2.parsed,source);
    composed=true;
    stage2tokens=stage2.tokens;
  } catch(error) {
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
    if(error instanceof ServiceError && error.code==='FREE_LIMIT')throw error;
    composeFailureCode=error instanceof ServiceError?error.code:'INVALID_OR_TIMEOUT';
    console.warn(JSON.stringify({event:'analysis.compose_failed',requestId,model,code:composeFailureCode,message:error instanceof Error?error.message.slice(0,160):'unknown'}));
    content=fallbackFromSource(source);
    // A narrow article-only retry is easier for a provider to satisfy than a
    // three-document structured response. It uses text evidence, never a new video call.
    // Do not retry a quota, permissions, or cancellation error.
    const retryable=['TEMPORARY_HTTP','TIMEOUT','INVALID_RESULT','PROVIDER_BUSY'].includes(composeFailureCode)
      && (!provided ||
        !!freeTextFallbackModel(model,composeFailureCode??''));
    if(retryable){
      onProgress({type:'progress',step:3,attempt:sourceCalls+2,label:'아티클 전용 복구 시도',detail:'전체 문서 요청이 실패해 더 작은 아티클 전용 요청을 한 번만 시도합니다. 무료 요청을 추가 사용합니다.'});
      try {
        compositionCalls++;
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,1000);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new ServiceError('CANCELLED','중단됨',499));},{once:true});});
        const articleModel=provided
          ?(freeTextFallbackModel(model,composeFailureCode??'')??model)
          :model;

        if(articleModel!==model)
          console.warn(JSON.stringify({
            event:'analysis.article_free_model_fallback',
            requestId,from:model,to:articleModel,
            reason:composeFailureCode
          }));

        const recovery=await interaction({key,model:articleModel,requestId,pass:'article-recovery',format:articleOnlyResponseFormat,
          input:[{type:'text',text:articleOnlyRecoveryPrompt(source,video.durationSeconds)}],signal,timeoutMs:provided?65000:90000,thinkingLevel:'low',maxOutputTokens:9000});
        content=recoverArticleFromSource(recovery.parsed,source);
        composed=true;
        finalModel=articleModel;
        composeRecovery='article-only';
        stage2tokens=recovery.tokens;
        console.info(JSON.stringify({event:'analysis.article_recovered',requestId,model,articleSections:content.article.length}));
      }catch(recoveryError){
        if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
        console.warn(JSON.stringify({event:'analysis.article_recovery_failed',requestId,model,code:recoveryError instanceof ServiceError?recoveryError.code:'INVALID_OR_TIMEOUT'}));
      }
    }
    if(!composed)onProgress({type:'progress',step:3,label:'AI 상세 문서 생성 실패',detail:'시간 지정 원문이 확보된 경우 전체 자막을 원문 문단으로 복구합니다.'});
  }
  if(provided && !composed){
    content={
      ...content,
      article:captionArticleFromEvidence(source.evidence),
      exclusions:[
        ...content.exclusions.filter(
          s=>!s.includes('상세 아티클 작성에 실패했습니다.')
        ),
        'AI 작성 요청이 실패했습니다. 아티클 영역에는 확보한 자막을 시간순으로 연결한 원문 문단을 표시합니다. AI가 작성한 해설문은 아닙니다.'
      ]
    };
    console.info(JSON.stringify({
      event:'analysis.caption_article_fallback',
      requestId,
      articleSections:content.article.length,
      sourceEvidence:source.evidence.length,
      composeFailureCode
    }));
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
  // Timed captions are the one source whose wording and time anchors we have.
  // Gemini may summarize them in the article but must not rewrite the timeline.
  content = {...content, timeline: provided
    ? timelineFromProvidedCaptions(source)
    : timelineFromSourceClaims(source.claims,source.evidence,content.timeline)};
  console.info(JSON.stringify({event:'analysis.timeline_granularity',requestId,sourceMode:provided?'user-captions':'video-url',before:timelineBefore,after:content.timeline.length}));
  const audit=assessSourceCoverage(source,content,video.durationSeconds,composed);
  const timing=assessTimelineTiming(content.timeline,source.evidence,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.timeline_time_review',requestId,sourceMode:provided?'user-captions':'video-url',gaps:timing.gaps,lastStartSeconds:timing.lastStartSeconds,lastEndSeconds:timing.lastEndSeconds,aiTimesUnverified:!provided}));
  console.info(JSON.stringify({event:'analysis.time_coverage',requestId,model,depth:'deep',missingWindows:missingEvidenceWindows(source.evidence,video.durationSeconds),sourceCalls}));
  if(composeRecovery)audit.qualityStatus='partial';
  // Sparse time coverage is a review warning in the timeline UI, not an excluded fact.
  if(composeRecovery)content.exclusions.push('복구된 아티클은 원본 근거를 사용했으나 요약·타임라인은 1차 근거 메모입니다. 전체 상세 분석으로 확정하지 않았습니다.');
  if(audit.articleIncomplete) content.exclusions.push(composed?'아티클이 상세도 기준에 미치지 못합니다. 근거만으로 충분한 설명을 생성하지 못했습니다.':provided?'AI 아티클 작성에 실패해 시간 지정 원문을 문단으로 복구했습니다. 자동 작성된 해설문이 아닙니다.':'2차 아티클 생성 실패: 아티클은 제공하지 않고 1차 근거 메모만 보여줍니다.');
  if(audit.qualityStatus==='partial') content.exclusions.push('부분 분석으로 분류했습니다. 실제 영상과 대조하여 누락된 내용을 확인하세요.');
  const result=recordFromContent(video,finalModel,source.evidence,content);
  result.analysisMeta={depth:'deep',videoProcessing:provided?'captions':videoProcessing,elapsedMs:Date.now()-analysisStarted,providerCalls:sourceCalls+compositionCalls,refinement:composed?'improved':'kept-first',pipeline:'evidence-compose',sourceClaims:source.claims.length,sourceEvidence:source.evidence.length, sourceMode:provided?'user-captions':'video-url', qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent,sourceEndPercent:audit.sourceEndPercent,articleChars:audit.articleChars,composeFailureCode,composeRecovery};
  onProgress({type:'progress',step:4,label:'근거 연결 검사 완료',detail:'존재하는 근거 ID·시간 범위를 확인했습니다. 사실 일치는 원본 대조가 필요합니다.'});
  const quality=assessDetail(content,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'deep',pipeline:'evidence-compose',providerCalls:sourceCalls+compositionCalls,sourceCalls,compositionCalls,composeRecovery:composeRecovery??null,composed,sourceClaims:source.claims.length,sourceEvidence:source.evidence.length,firstInputTokens:stage1?.tokens.input??null,firstOutputTokens:stage1?.tokens.output??null,secondTokens:stage2tokens,contentMetrics:quality.counts,shortFields:quality.shortFields,sourceMode:result.analysisMeta.sourceMode,qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent,sourceEndPercent:audit.sourceEndPercent,sourceBuckets:audit.sourceBuckets,articleChars:audit.articleChars,sourceIncomplete:audit.sourceIncomplete,articleIncomplete:audit.articleIncomplete,composeFailureCode:composeFailureCode??null}));
  return result;
}
// Focus on audible speech ONLY in each independent static clip. Unlike a combined
// video+article request, this does not ask Gemini to compose prose while listening.
const clipSpeechFormat={type:'text',mime_type:'application/json',schema:{type:'object',properties:{lines:{type:'array',items:{type:'object',properties:{startSeconds:{type:'number'},endSeconds:{type:'number'},text:{type:'string'}},required:['startSeconds','endSeconds','text']}}},required:['lines']}};
function speechClipFailureMessage(code:ReturnType<typeof speechClipFailureCode>):string {
  const messageByCode:Record<ReturnType<typeof speechClipFailureCode>,string>={
    FREE_LIMIT:'Gemini 무료 할당량이 소진되어 발언을 확보하지 못했습니다. 추가 API 호출을 중단했습니다.',
    GOOGLE_REQUEST_REJECTED:'Google이 영상 분석 요청을 거절했습니다. API 키·모델·영상 접근 권한을 확인해주세요.',
    PROVIDER_BUSY:'Gemini가 영상 입력에서 HTTP 503을 반복 반환했습니다. 다른 무료 모델의 연결도 확인했으나 발언을 확보하지 못했습니다. Gemini 제공자 상태 또는 해당 YouTube URL 처리 문제일 수 있습니다. 영상에 음성이 없다는 의미는 아닙니다.',
    TIMEOUT:'Gemini 영상 입력 처리가 제한시간 내에 완료되지 않았습니다. 추가 영상 구간 호출을 중단했습니다.',
    PROVIDER_UNAVAILABLE:'Gemini 영상 입력 실패로 발언을 확보하지 못했습니다. 터미널 로그에서 요청 ID와 제공자 오류를 확인해주세요.',
    INVALID_RESULT:'영상에서 확인 가능한 발언을 확보하지 못했습니다. 검증되지 않은 발언을 임의로 생성하지 않습니다.',
  };
  return messageByCode[code];
}
async function speechFocusedAnalysis(video:VideoInfo,model:FreeModelId,key:string,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal):Promise<AnalysisRecord>{
  const started=Date.now();
  const segments=precisionSpeechSegments(video.durationSeconds,'static');
  console.info(JSON.stringify({event:'analysis.precision_clips',requestId,windows:segments.map(s=>({from:s.from,to:s.to,coreFrom:s.coreFrom,coreTo:s.coreTo}))}));
  const outcomes:Array<{segment:typeof segments[number];parsed?:unknown;failure?:string}>=[];
  let providerCalls=0;
  let activeModel:FreeModelId=model;
  const ordered=[segments.at(-1)!,...segments.slice(0,-1)];

  // A single late-clip probe establishes whether Google can actually process
  // this YouTube URL. Never issue all three requests into an observed outage.
  async function requestClip(segment:typeof segments[number],chosenModel:FreeModelId,timeoutMs:number){
    providerCalls++;
    onProgress({type:'progress',step:2,label:`발언 구간 확인 ${segment.index+1}/${segments.length}`,detail:`${chosenModel} · 영상 ${segment.from}~${segment.to}초 발언을 확인합니다. 무료 요청 ${providerCalls}회차입니다.`});
    try{
      const req=makeSpeechClipRequest(video.url,segment);
      const output=await interaction({key,model:chosenModel,requestId,pass:`speech-clip-${segment.index}`,input:req,format:clipSpeechFormat,signal,timeoutMs,thinkingLevel:'low',maxOutputTokens:4800});
      return {segment,parsed:output.parsed};
    }catch(err){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      const code=err instanceof ServiceError?err.code:'PROVIDER_UNAVAILABLE';
      console.warn(JSON.stringify({event:'analysis.speech_clip_failed',requestId,index:segment.index,from:segment.from,to:segment.to,model:chosenModel,code}));
      return {segment,failure:code};
    }
  }

  const probe=await requestClip(ordered[0],model,SPEECH_PROBE_TIMEOUT_MS);
  outcomes.push(probe);
  if(probe.failure && shouldTryFreeModelFallback(probe.failure)){
    // The only alternative is explicitly present in the existing free-tier
    // allowlist. If the alternative also fails, fail fast with the real code.
    const other=FREE_MODELS.find(item=>item.id!==model)?.id;
    if(other){
      console.warn(JSON.stringify({event:'analysis.speech_free_model_fallback',requestId,from:model,to:other,reason:probe.failure}));
      onProgress({type:'progress',step:2,label:'다른 무료 Gemini 모델 확인',detail:`${model} 영상 요청 실패(${probe.failure}). ${other} 무료 모델로 마지막 연결 확인을 시도합니다. 유료 모델은 사용하지 않습니다.`});
      try{await waitBeforeProviderRetry(signal,SPEECH_FALLBACK_WAIT_MS);}
      catch{throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);}
      const alternate=await requestClip(ordered[0],other,SPEECH_PROBE_TIMEOUT_MS);
      if(!alternate.failure){
        activeModel=other;
        outcomes.splice(0,1,alternate);
        console.info(JSON.stringify({event:'analysis.speech_free_model_fallback_succeeded',requestId,model:activeModel}));
      }else{
        outcomes.push(alternate);
        console.warn(JSON.stringify({event:'analysis.speech_outage_fast_stop',requestId,models:[model,other],codes:[probe.failure,alternate.failure],providerCalls}));
      }
    }
  }

  // A failed probe means we have no verified speech source. In particular,
  // do NOT launch the two additional clips or repeat an unavailable model.
  if(outcomes[0]?.failure){
    const code=speechClipFailureCode(outcomes);
    throw new ServiceError(code,speechClipFailureMessage(code),code==='FREE_LIMIT'?429:code==='PROVIDER_BUSY'?503:code==='TIMEOUT'?504:502);
  }

  // Short overlapping clips limit intra-clip clock drift and help retain
  // sentences around former 67-second boundaries. Rate-limit to two requests
  // in flight, keep one absolute deadline, stop on 429, and keep partial work.
  // Model-estimated local timestamps still require review against the video.
  const speechDeadline=started+205000;
  const finalDeadline=started+265000;
  for(let offset=1;offset<ordered.length;offset+=2){
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
    const remaining=speechDeadline-Date.now();
    if(remaining<12000){
      console.warn(JSON.stringify({event:'analysis.precision_deadline',requestId,providerCalls,remainingSegments:ordered.length-offset}));
      break;
    }
    const rest=await Promise.all(ordered.slice(offset,offset+2).map(segment=>requestClip(segment,activeModel,Math.min(SPEECH_CLIP_TIMEOUT_MS,remaining))));
    outcomes.push(...rest);
    if(rest.some(outcome=>outcome.failure==='FREE_LIMIT'))break;
  }
  // HTTP 429 means the provider did NOT transcribe the requested primary clips.
  // Never turn a successful late-clip probe into a fake completed full video.
  const quotaClips=outcomes.filter(o=>o.failure==='FREE_LIMIT');
  if(quotaClips.length){
    console.warn(JSON.stringify({event:'analysis.speech_quota_abort',requestId,phase:'primary_clips',failedIndices:quotaClips.map(x=>x.segment.index),successfulIndices:outcomes.filter(x=>x.parsed&&!x.failure).map(x=>x.segment.index),providerCalls,resultDiscarded:true}));
    throw new ServiceError('FREE_LIMIT','Google Gemini가 영상 구간 분석 도중 HTTP 429(무료 사용량 또는 요청 속도 제한)를 반환했습니다. 영상 전체를 확보하지 못해 일부 발언만으로 분석 결과를 생성하지 않았습니다. 제한이 해제된 후 다시 시도하거나 시간 지정 자막을 입력해 주세요.',429);
  }
  const merged=collectSpeechClipResults(outcomes,segments);
  // Keep distinct audible phrases the strict time-overlap filter rejected.
  // All candidates still need a valid original clip and core ownership.
  const preserved=salvageRejectedSpeech(outcomes,segments,merged.lines,video.durationSeconds);
  let finalLines=mergeSpeechSentences(preserved.lines,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.speech_preservation_audit',requestId,strictLines:merged.lines.length,rawRows:preserved.seen,salvaged:preserved.recovered,invalid:preserved.invalid,contextOnly:preserved.outsideCore,duplicates:preserved.duplicates,conflictingTimeRecovered:preserved.overlappingRecovered,perClip:preserved.perClip}));
  let auditQuotaExceeded=false;
  let coverageReviews=0;
  let coverageAdded=0;
  let clockCorrections=0;
  // Up to three bounded evidence-based audio relistens cover actual gaps, including head and tail.
  // Unlike text-only composition, these requests can discover absent utterances.
  const repairWindows=planSpeechRepairWindows(finalLines,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.speech_repair_plan',requestId,windows:repairWindows,firstStart:finalLines[0]?.startSeconds??null,lastEnd:finalLines.at(-1)?.endSeconds??null}));
  // A missing minute is larger than one 52s video clip. Parallelize only
  // its first two split windows so the same 205s speech deadline has a real
  // chance to hear BOTH halves. Reconcile results serially in timestamp order.
  const severeInterval=largestSpeechGap(finalLines,video.durationSeconds,54);
  const splitSevere=Boolean(severeInterval && severeInterval.from>0 && severeInterval.to<video.durationSeconds &&
    repairWindows.length>=2 && repairWindows[0].from<=severeInterval.from && repairWindows[1].to>=severeInterval.to);
  type CoverageAttempt={reviewIndex:number;window:typeof repairWindows[number];reviewed?:ReturnType<typeof extractCoverageReviewRows>};
  async function listenCoverage(reviewIndex:number,coverageWindow:typeof repairWindows[number]):Promise<CoverageAttempt>{
    const remaining=speechDeadline-Date.now();
    if(remaining<15000){
      console.warn(JSON.stringify({event:'analysis.speech_coverage_review_skipped',requestId,reason:'time_budget',reviewIndex,remaining}));
      return {reviewIndex,window:coverageWindow};
    }
    coverageReviews++;
    providerCalls++;
    onProgress({type:'progress',step:2,label:`누락 발언 재확인 ${reviewIndex+1}/${repairWindows.length}`,detail:`영상 ${coverageWindow.from}~${coverageWindow.to}초를 독립적으로 다시 듣고 누락된 실제 발언을 확인합니다. 무료 요청 ${providerCalls}회차입니다.`});
    try{
      const secondListen=await interaction({key,model:activeModel,requestId,pass:`speech-coverage-${reviewIndex}`,input:makeSpeechCoverageRequest(video.url,coverageWindow),format:clipSpeechFormat,signal,timeoutMs:Math.min(41000,remaining-1000),thinkingLevel:'low',maxOutputTokens:4600});
      return {reviewIndex,window:coverageWindow,reviewed:extractCoverageReviewRows(secondListen.parsed,coverageWindow,video.durationSeconds)};
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      const code=error instanceof ServiceError?error.code:'PROVIDER_UNAVAILABLE';
      if(code==='FREE_LIMIT')auditQuotaExceeded=true;
      console.warn(JSON.stringify({event:'analysis.speech_coverage_review_failed',requestId,reviewIndex,code}));
      return {reviewIndex,window:coverageWindow};
    }
  }
  for(let reviewIndex=0;reviewIndex<repairWindows.length;){
    if(outcomes.some(x=>x.failure==='FREE_LIMIT')||auditQuotaExceeded)break;
    const batchSize=splitSevere&&reviewIndex===0?2:1;
    const attempted=await Promise.all(repairWindows.slice(reviewIndex,reviewIndex+batchSize)
      .map((coverageWindow,index)=>listenCoverage(reviewIndex+index,coverageWindow)));
    // No concurrent mutation of finalLines: both independent video listens
    // finish, then each validated result is merged into the latest transcript.
    for(const attempt of attempted){
      if(!attempt.reviewed)continue;
      const reviewed=attempt.reviewed,coverageWindow=attempt.window;
      const reconciled=mergeIndependentCoverage(finalLines,reviewed.lines,coverageWindow,video.durationSeconds);
      finalLines=mergeSpeechSentences(reconciled.lines,video.durationSeconds);
      coverageAdded+=reconciled.added;
      clockCorrections+=reconciled.corrections;
      console.info(JSON.stringify({event:'analysis.speech_coverage_review',requestId,reviewIndex:attempt.reviewIndex,window:coverageWindow,heard:reviewed.lines.length,invalid:reviewed.invalid,added:reconciled.added,duplicates:reconciled.duplicates,timeCorrections:reconciled.corrections,reason:reconciled.reason,total:finalLines.length}));
    }
    reviewIndex+=batchSize;
  }
  // Avoid redundant third/fourth listens if central coverage cross-check ran.
  const uncovered=coverageReviews===0 && finalLines.length>=8 ? chooseSpeechGapAudit(finalLines,video.durationSeconds,8) : null;
  // One bounded additional listen only for an observed large gap. No blind
  // whole-video regeneration; avoid infinite retries and respect 429/deadlines.
  if(uncovered && !outcomes.some(x=>x.failure==='FREE_LIMIT') && speechDeadline-Date.now()>17000){
    const recoverySegment={index:100,from:Math.max(0,Math.floor(uncovered.from)-3),to:Math.min(video.durationSeconds,Math.ceil(uncovered.to)+3),coreFrom:Math.max(0,Math.floor(uncovered.from)-3),coreTo:Math.min(video.durationSeconds,Math.ceil(uncovered.to)+3)};
    providerCalls++;
    onProgress({type:'progress',step:2,label:'누락 발언 구간 재확인',detail:`${Math.floor(uncovered.from)}~${Math.ceil(uncovered.to)}초의 긴 공백을 한 번 더 확인합니다. 무료 요청이 추가됩니다.`});
    try{
      const repaired=await interaction({key,model:activeModel,requestId,pass:'speech-gap-review',input:makeSpeechClipRequest(video.url,recoverySegment),format:clipSpeechFormat,signal,timeoutMs:Math.min(42000,speechDeadline-Date.now()),thinkingLevel:'low',maxOutputTokens:4800});
      const additions=parseSegmentedSpeech({segmentTranscripts:[{segmentIndex:100,lines:(repaired.parsed as {lines?:unknown})?.lines}]},[recoverySegment]).lines;
      const checked=mergeGapAuditedLines(finalLines,additions,uncovered,video.durationSeconds);
      finalLines=mergeSpeechSentences(checked.lines,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.speech_gap_review',requestId,from:uncovered.from,to:uncovered.to,received:additions.length,accepted:checked.added,rejected:checked.rejected,totalLines:finalLines.length}));
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      if(error instanceof ServiceError && error.code==='FREE_LIMIT')auditQuotaExceeded=true;
      console.warn(JSON.stringify({event:'analysis.speech_gap_review_failed',requestId,code:error instanceof ServiceError?error.code:'PROVIDER_UNAVAILABLE'}));
    }
  }
  // One independent, SHORT video listen may corroborate model-estimated
  // timings after 01:00. Corrections require two distinct EXACT utterance
  // matches with a consistent shift; otherwise keep original timecodes.
  const clockWindow=planSpeechClockAudit(finalLines,video.durationSeconds);
  if(clockWindow && coverageReviews===0 && !auditQuotaExceeded && !outcomes.some(x=>x.failure==='FREE_LIMIT') && speechDeadline-Date.now()>19000){
    providerCalls++;
    onProgress({type:'progress',step:2,label:'1분 이후 발언 시각 재검토',detail:`영상 ${clockWindow.from}~${clockWindow.to}초의 실제 발언을 짧게 다시 듣고, 두 문장 이상 일치할 때만 시간을 보정합니다.`});
    try{
      const reviewed=await interaction({key,model:activeModel,requestId,pass:'speech-clock-audit',input:makeSpeechClockAuditRequest(video.url,clockWindow,finalLines),format:clipSpeechFormat,signal,timeoutMs:Math.min(32000,speechDeadline-Date.now()),thinkingLevel:'low',maxOutputTokens:2500});
      const verified=applySpeechClockAudit(finalLines,reviewed.parsed,clockWindow,video.durationSeconds);
      finalLines=verified.lines;
      console.info(JSON.stringify({event:'analysis.speech_clock_audit',requestId,window:clockWindow,corrections:verified.corrections,reason:verified.reason}));
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
      if(error instanceof ServiceError && error.code==='FREE_LIMIT')auditQuotaExceeded=true;
      console.warn(JSON.stringify({event:'analysis.speech_clock_audit_failed',requestId,code:error instanceof ServiceError?error.code:'PROVIDER_UNAVAILABLE'}));
    }
  }
  // Optional video relistens can also exhaust the free tier. In that case,
  // never quietly skip article generation and call the output 'completed'.
  if(auditQuotaExceeded){
    console.warn(JSON.stringify({event:'analysis.speech_quota_abort',requestId,phase:'audio_review',providerCalls,resultDiscarded:true}));
    throw new ServiceError('FREE_LIMIT','무료 Gemini 사용량 또는 요청 속도 제한(HTTP 429)으로 발언 검토가 중단됐습니다. 불완전한 결과를 성공으로 저장하지 않았습니다. 제한이 해제된 후 다시 시도하거나 시간 지정 자막을 입력해 주세요.',429);
  }
  // All independent audio reviews are finished. Reject cross-time collages
  // and duplicated quote fragments WITHOUT merging unrelated spoken words.
  const finalized=finalizeSpeechTimeline(finalLines,video.durationSeconds);
  finalLines=finalized.lines;
  console.info(JSON.stringify({event:'analysis.speech_final_reconcile',requestId,before:finalLines.length+finalized.duplicatesRemoved+finalized.collagesQuarantined,after:finalLines.length,duplicatesRemoved:finalized.duplicatesRemoved,collagesQuarantined:finalized.collagesQuarantined,unverifiedTimeCollisions:finalized.unverifiedTimeCollisions}));
  // A failed primary clip plus an unresolved >=45s interval is not a
  // usable full-video transcript, even when other clips succeeded.
  const failedCoreGap=merged.failedSegments.length ? largestSpeechGap(finalLines,video.durationSeconds,45) : null;
  if(failedCoreGap){
    console.warn(JSON.stringify({event:'analysis.speech_incomplete_abort',requestId,failedSegments:merged.failedSegments,unverifiedWindow:failedCoreGap,providerCalls,resultDiscarded:true}));
    throw new ServiceError('SPEECH_INCOMPLETE',`영상의 주요 구간 분석 실패로 ${formatMissingWindows([failedCoreGap])} 발언을 확인하지 못했습니다. 일부 결과만으로 완료 처리하지 않았습니다. 잠시 후 재시도하거나 시간 지정 자막을 입력해 주세요.`,503);
  }
  const unresolvedSevereGap=largestSpeechGap(finalLines,video.durationSeconds,35);
  const severeGapWarning=unresolvedSevereGap && unresolvedSevereGap.from>0 && unresolvedSevereGap.to<video.durationSeconds ? unresolvedSevereGap : null;
  if(severeGapWarning)console.warn(JSON.stringify({event:'analysis.speech_severe_gap_unresolved',requestId,window:severeGapWarning,providerCalls,coverageReviews,quotaStopped:auditQuotaExceeded||outcomes.some(x=>x.failure==='FREE_LIMIT')}));
  const source=speechSource(finalLines,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.speech_clip_coverage',requestId,model:activeModel,coveredSegments:merged.coveredSegments,failedSegments:merged.failedSegments,missingWindows:merged.missingWindows,lines:merged.lines.length,rejected:merged.rejected,lastEnd:finalLines.at(-1)?.endSeconds??null,providerCalls}));
  if(!source.claims.length){
    const code=speechClipFailureCode(outcomes);
    throw new ServiceError(code,speechClipFailureMessage(code),code==='FREE_LIMIT'?429:code==='PROVIDER_BUSY'?503:code==='TIMEOUT'?504:502);
  }
  let content=fallbackFromSource(source);
  let composeOk=false;
  if(!auditQuotaExceeded && !outcomes.some(o=>o.failure==='FREE_LIMIT') && finalDeadline-Date.now()>=12000){
    onProgress({type:'progress',step:3,label:'발언 기반 문서 작성',detail:`확보한 발언 ${source.claims.length}개로 요약·아티클을 작성합니다. 발언 문장과 시각은 변경하지 않습니다.`});
    providerCalls++;
    try{
      const composed=await interaction({key,model:activeModel,requestId,pass:'speech-compose',input:[{type:'text',text:composePrompt(source,video.durationSeconds)}],format:composedResponseFormat,signal,timeoutMs:Math.min(75000,finalDeadline-Date.now()),thinkingLevel:'low',maxOutputTokens:6500});
      const parsed=extractComposedContent(composed.parsed,source);
      content={...parsed};composeOk=true;
    }catch(error){
      if(signal?.aborted)throw error;
      if(error instanceof ServiceError && error.code==='FREE_LIMIT'){
        console.warn(JSON.stringify({event:'analysis.speech_quota_abort',requestId,phase:'compose',providerCalls,resultDiscarded:true}));
        throw new ServiceError('FREE_LIMIT','무료 Gemini 사용량 또는 요청 속도 제한(HTTP 429)으로 아티클 생성이 중단됐습니다. 완성된 분석으로 표시하지 않았습니다. 제한이 해제된 후 다시 시도해 주세요.',429);
      }
      console.warn(JSON.stringify({event:'analysis.speech_compose_failed',requestId,code:error instanceof ServiceError?error.code:'UNKNOWN'}));
    }
  }
  // The timeline always comes from the obtained utterances. AI timecodes
  // remain unverified until checked against the actual video or timed captions.
  const mapped=speechFirstTimeline(finalLines,source.evidence,video.durationSeconds);
  content.timeline=mapped.timeline;
  content.transcript=finalLines;
  const missing=formatMissingWindows(speechReviewWindows(finalLines,video.durationSeconds));
  content.exclusions=content.exclusions.filter(x=>!/(마지막 원문 근거 종료|발화 없음|영상의 일부 발언 구간)/.test(x));
  if(missing)content.exclusions.push(`발언을 확인하지 못한 시간 구간: ${missing}. 확인되지 않은 발언과 시각은 생성하지 않았습니다.`);
  if(severeGapWarning)content.exclusions.push(`⚠️ 심각한 발언 누락: ${formatMissingWindows([severeGapWarning])} 구간의 음성을 충분히 확보하지 못했습니다. 타임라인이 불완전하며, 해당 구간을 확인할 수 있는 시간 지정 자막 또는 재분석이 필요합니다.`);
  if(finalized.collagesQuarantined)content.exclusions.push(`서로 다른 시간대의 발언이 섞인 것으로 의심되는 문장 ${finalized.collagesQuarantined}개는 타임라인에서 제외했습니다. 원본 영상 대조가 필요합니다.`);
  if(finalized.unverifiedTimeCollisions)content.exclusions.push(`내용이 다른 문장 사이의 추정 시각 겹침 ${finalized.unverifiedTimeCollisions}건은 실제 음성 시각을 검증하지 못해 그대로 보존했습니다.`);
  if(preserved.recovered>0 || coverageAdded>0)content.exclusions.push('영상 발언 누락 방지를 위해 겹치는 추정 시각의 서로 다른 문장과 독립 재분석에서 확인된 발언을 보존했습니다. 시각은 원본과 대조해야 합니다.');
  if(clockCorrections>0)content.exclusions.push('일부 문장의 추정 시각을 독립 영상 재분석의 두 문장 이상 일치 결과로 보정했습니다. 정확한 초 단위 정렬을 보증하지 않습니다.');
  if(!composeOk)content.exclusions.push('발언 문서 작성에 실패해 검증 전 발언 메모만 표시합니다.');
  if(activeModel!==model)content.exclusions.push(`선택된 ${model} 모델의 제공자 오류로 허용된 다른 무료 모델(${activeModel})을 사용했습니다. 모델별 전사 품질이 다를 수 있으므로 원본과 대조해주세요.`);
  const result=recordFromContent(video,activeModel,mapped.evidence,content);
  const partial=Boolean(speechReviewWindows(finalLines,video.durationSeconds).length)||Boolean(merged.failedSegments.length)||!composeOk;
  result.analysisMeta={depth:'standard',videoProcessing:'static',elapsedMs:Date.now()-started,providerCalls,refinement:composeOk?'not-needed':'kept-first',pipeline:'single-pass',sourceMode:'video-url',qualityStatus:partial?'partial':'review',sourceEndPercent:finalLines.length?(finalLines.at(-1)!.endSeconds/video.durationSeconds*100):0};
  onProgress({type:'progress',step:4,label:partial?'구간별 발언 일부 확인':'구간별 발언 수집 완료',detail:partial?'확인하지 못한 구간은 표기하고 원문을 임의로 채우지 않았습니다.':'짧은 중복 클립의 발언 원문을 취합했습니다. 시각은 영상으로 최종 대조해주세요.'});
  console.info(JSON.stringify({event:'analysis.completed',requestId,model:activeModel,mode:'speech-focused',providerCalls,lines:finalLines.length,missingWindows:speechReviewWindows(finalLines,video.durationSeconds),composeOk,elapsedMs:Date.now()-started}));
  return result;
}

export async function analyzeVideo(video:VideoInfo,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,depth:'standard'|'deep'='standard',model:FreeModelId=FREE_MODEL,captionText?:string,processingPreference:VideoProcessingPreference='auto',retryOnBusy=true,recoverMissingSpeech=false,segmentShortSpeech=true,autoSpeech=false):Promise<AnalysisRecord>{
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new ServiceError('NOT_CONFIGURED','Google AI Studio 무료 등급 API 키가 필요합니다.',503);
  const videoProcessing=resolveVideoProcessing(video.durationSeconds,model,processingPreference);
  if(!captionText?.trim()){
    onProgress({type:'progress',step:2,label:'공개 시간 지정 자막 확인',detail:'별도 Gemini 영상 호출 없이 공개 한국어 자막이 있는지 확인합니다. 사용 불가하면 기존 영상 분석을 사용합니다.'});
    const captions=await fetchPublicKoreanCaptions(video.id,video.durationSeconds,signal)
      ?? await fetchYtDlpKoreanCaptions(video.id,video.durationSeconds,signal);
    console.info(JSON.stringify({event:'analysis.public_captions',requestId,available:!!captions,cueCount:captions?.count??0,endSeconds:captions?.end??null}));
    if(captions){
      const originalCaptionLines=parseTimedCaptionSrt(
        captions.srt,video.durationSeconds
      );

      // Preserve the unmodified YouTube cues for comparison.
      // This local pass works even when Gemini is unavailable.
      const localCleanup=normalizeCaptionErrors(originalCaptionLines);
      let baselineLines=originalCaptionLines;
      let localCorrections=0;

      if(localCleanup.changed>0){
        const localSrt=correctedLinesToSrt(localCleanup.lines);
        const checked=parseTimedCaptionSrt(localSrt,video.durationSeconds);

        const valid=checked.length===originalCaptionLines.length &&
          checked.every((line,i)=>
            line.startSeconds===originalCaptionLines[i].startSeconds &&
            line.endSeconds===originalCaptionLines[i].endSeconds
          );

        if(valid){
          captions.srt=localSrt;
          baselineLines=localCleanup.lines;
          localCorrections=localCleanup.changed;
        }
      }

      console.info(JSON.stringify({
        event:'analysis.caption_local_cleanup',
        requestId,
        cues:originalCaptionLines.length,
        changed:localCorrections,
        repeated:localCorrections?localCleanup.repeated:0,
        strategy:'domain-neutral'
      }));

      const analysisStarted=Date.now();
      const source=sourceFromUserCaptions(
        captions.srt,video
      );

      // The timed captions, not Gemini, own the actual timestamps.
      const originalEvidence=baselineLines.map((line,i)=>({
        id:`timed-caption-e-${i}`,
        startSeconds:line.startSeconds,
        endSeconds:line.endSeconds,
        kind:'caption' as const,
        note:line.text
      }));

      onProgress({
        type:'progress',
        step:2,
        label:'Gemini 무료 API · 1회 통합 분석',
        detail:'자막 교정·요약·상세 아티클을 한 번에 생성합니다. 추가 교정 호출은 하지 않습니다.'
      });

      try{
        // Exactly one Gemini interaction for an available
        // YouTube Korean caption track. No API retries here.
        const response=await interaction({
          key,model,requestId,
          pass:'caption-single-pass',
          format:captionOneCallFormat,
          input:[{
            type:'text',
            text:captionOneCallPrompt(
              baselineLines,
              source,
              video.title,
              video.durationSeconds
            )
          }],
          signal,
          timeoutMs:100000,
          thinkingLevel:model==='gemini-3.8-flash'
            ?'medium':'low',
          maxOutputTokens:12000
        });

        const raw=response.parsed &&
          typeof response.parsed==='object'
          ?(response.parsed as {
            corrections?:unknown
          }).corrections
          :undefined;

        const proposed=Array.isArray(raw)
          ?raw.length:0;

        const fixed=applyCaptionProofread(
          baselineLines,response.parsed
        );

        // Conservative, domain-neutral repair of a particle
        // changed by a previously accepted noun replacement.
        const syntactic=repairCaptionQuotationParticles(
          baselineLines,fixed.lines
        );
        const grammarAdjusted=syntactic.reduce(
          (count,line,i)=>
            count+(line.text!==fixed.lines[i].text?1:0),0
        );

        const candidate=fixed.accepted+grammarAdjusted>0
          ?correctedLinesToSrt(syntactic)
          :captions.srt;

        const verified=parseTimedCaptionSrt(
          candidate,video.durationSeconds
        );

        const timecodesPreserved=
          verified.length===originalCaptionLines.length &&
          verified.every((line,i)=>
            line.startSeconds===
              originalCaptionLines[i].startSeconds &&
            line.endSeconds===
              originalCaptionLines[i].endSeconds
          );

        if(!timecodesPreserved)
          throw new ServiceError(
            'INVALID_RESULT',
            '교정 과정에서 자막 시간 정보가 달라졌습니다.',
            502
          );

        captions.srt=candidate;

        // Reconcile the original evidence IDs with the now
        // verified corrected captions, without new timecodes.
        const correctedSource=reconcileCaptionSource(
          source,verified
        );
        const correctedEvidence=originalEvidence.map(
          (entry,i)=>({...entry,note:verified[i].text})
        );

        let content:AnalysisContent;
        let composed=false;

        try{
          content=extractComposedContent(
            {...(response.parsed as object),timeline:[]},
            correctedSource
          );

          composed=content.summary.length>0 &&
            content.article.length>0;

        }catch{
          content={
            summary:[],
            timeline:[],
            article:[],
            transcript:[],
            exclusions:[]
          };
        }

        if(!content.article.length){
          content.article=captionArticleFromEvidence(
            correctedEvidence
          );

          content.exclusions.push(
            'Gemini 1회 요청은 완료됐지만 상세 아티클의 근거 검증에 실패했습니다. 아티클 영역은 확인된 자막 원문으로 대체했으며 AI 완성 문서가 아닙니다.'
          );
        }

        if(!content.summary.length)
          content.exclusions.push(
            'Gemini의 핵심 요약 결과에서 유효한 근거 연결을 확인하지 못했습니다.'
          );

        // Timeline and transcript are built from corrected timed cues,
        // never from fabricated model timestamps.
        const result=recordFromContent(
          video,model,correctedSource.evidence,content
        );

        const preserved=preserveTimedCaptionTimeline(
          result,captions.srt,video.durationSeconds
        );

        result.analysisMeta={
          depth,
          videoProcessing:'captions',
          elapsedMs:Date.now()-analysisStarted,
          inputTokens:response.tokens.input??undefined,
          outputTokens:response.tokens.output??undefined,
          providerCalls:1,
          refinement:'not-needed',
          pipeline:'single-pass',
          sourceMode:'public-captions',
          sourceClaims:correctedSource.claims.length,
          sourceEvidence:correctedSource.evidence.length,
          qualityStatus:composed?'review':'partial',
          articleChars:content.article.reduce(
            (n,item)=>n+item.text.length,0
          ),
          captionProofreadStatus:
            fixed.accepted+grammarAdjusted>0?'applied':'unchanged',
          captionProofreadAccepted:fixed.accepted,
          captionProofreadProposed:proposed,
          captionLocalCorrections:
            localCorrections+grammarAdjusted,
          ...(composed?{}:{
            composeFailureCode:'INCOMPLETE_RESULT'
          })
        };

        result.analysisMeta.sourceMode='public-captions';

        if(fixed.accepted+grammarAdjusted+localCorrections>0)
          result.rawCaptionTranscript=originalCaptionLines;

        console.info(JSON.stringify({
          event:'analysis.caption_single_pass_completed',
          requestId,model,
          providerCalls:1,
          cues:preserved,
          proposed,
          accepted:fixed.accepted,
          rejected:fixed.rejected,
          localCorrections,
          grammarAdjusted,
          evidenceSynced:correctedSource!==source,
          timecodesPreserved,
          summary:content.summary.length,
          article:content.article.length,
          articleGenerated:composed
        }));

        console.info(JSON.stringify({
          event:'analysis.caption_first',
          requestId,cues:preserved,
          end:captions.end,
          source:'timed-youtube-caption'
        }));

        return result;

      }catch(error){
        if(signal?.aborted)throw error;

        if(error instanceof ServiceError &&
           error.code==='CANCELLED')
          throw error;

        const code=error instanceof ServiceError
          ?error.code:'INVALID_RESULT';

        // No second Gemini call, including on 429, 503
        // or malformed JSON. Never silently imply AI success.
        const content:AnalysisContent={
          summary:[],
          timeline:baselineLines.map((line,i)=>({
            id:`timed-caption-t-${i}`,
            text:line.text,
            evidenceIds:[originalEvidence[i].id]
          })),
          article:captionArticleFromEvidence(originalEvidence),
          transcript:baselineLines,
          exclusions:[
            `Gemini 무료 API 통합 분석 실패(${code}). 원본 자막으로 결과를 복구했습니다. AI 교정 및 상세 아티클은 완성되지 않았습니다.`
          ]
        };

        const fallback=recordFromContent(
          video,model,originalEvidence,content
        );

        fallback.analysisMeta={
          depth,
          videoProcessing:'captions',
          providerCalls:1,
          refinement:'kept-first',
          pipeline:'single-pass',
          sourceMode:'public-captions',
          qualityStatus:'partial',
          composeFailureCode:code,
          captionProofreadStatus:'failed',
          captionProofreadAccepted:0,
          captionProofreadProposed:0,
          captionProofreadCode:code,
          captionLocalCorrections:localCorrections
        };

        if(localCorrections>0)
          fallback.rawCaptionTranscript=originalCaptionLines;

        console.warn(JSON.stringify({
          event:'analysis.caption_first_fallback',
          requestId,
          code,
          providerCalls:1,
          captionLines:baselineLines.length,
          articleGenerated:false,
          captionArticleSections:content.article.length
        }));

        return fallback;
      }
    }
  }
  if(depth==='deep' || captionText?.trim())return deepAnalysis(video,model,key,requestId,onProgress,signal,captionText,videoProcessing,retryOnBusy);
  if(autoSpeech && video.durationSeconds>=120 && video.durationSeconds<=300 && videoProcessing==='static'){
    return speechFocusedAnalysis(video,model,key,requestId,onProgress,signal);
  }
  const analysisStarted=Date.now();
  const targets=detailTargets(video.durationSeconds);
  const windows=coverageWindows(video.durationSeconds).map((w,i)=>`${i+1}구간 ${w.label}`).join(' / ');
  const detailInstructions=`타임라인의 text는 제삼자 설명문이 아니라 화자의 발언처럼 자연스럽고 원문 어순에 충실하게 작성한다. '설명함/소개함/권장함' 같은 메모체와 영상에 없는 의학적 보강을 하지 않는다. 예를 들어 화자가 '하지만 이 질병의 80%가 다리에서 시작됩니다'라고 했다면 '뇌경색 위험의 80%가 다리 질환과 연관'처럼 대상을 바꾸지 않는다. 정확하게 들리지 않으면 제외한다. 이 입력은 검증된 전사 원문이 아니므로 그대로 들었다고 확신하거나 인증하지 않는다.\n검토해야 할 실제 시간 구간: ${windows}. 후반부를 먼저 확인하되 최종 출력은 시작 시각 순서로 정렬할 것. 각 구간의 실제 발언을 따로 점검하고, 없던 발언을 새로 만들어 항목 수를 채우지 말 것.\n영상 ${video.durationSeconds}초: 근거가 충분하면 요약 ${targets.summary}개 이상, 타임라인 ${targets.timeline}개 이상, 아티클 소제목 ${targets.article}개 이상을 목표로 하되 근거 없는 내용은 절대 생성하지 마라.`;
  // Google 503 is optionally retried ONCE. Other failures, especially 429, are not retried.
  const firstTimeoutMs=video.durationSeconds<300?120000:150000;
  // A single basic analysis has ONE wall-clock budget, not 90 seconds per attempt.
  const basicDeadlineMs=Date.now()+firstTimeoutMs;
  const attempts=retryOnBusy?[firstTimeoutMs,firstTimeoutMs]:[firstTimeoutMs];let lastError:unknown;
  for(let i=0;i<attempts.length;i++){
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
    const remainingMs=remainingBasicAnalysisMs(basicDeadlineMs,Date.now());
    if(remainingMs<5000)throw new ServiceError('TIMEOUT','기본 영상 분석의 전체 대기 시간이 초과됐습니다.',504);
    const attemptStarted=Date.now();
    onProgress({type:'progress',step:2,attempt:i+1,label:i===0?'기본 영상 분석':'Google 503 · 마지막 재시도',detail:i===0?'영상에서 근거를 찾고 한국어 결과물을 생성하고 있습니다.':'일시적인 Google 서버 혼잡으로 같은 무료 모델에 마지막 한 번 더 요청합니다.'});
    try {
      const segments=segmentShortSpeech?shortSpeechSegments(video.durationSeconds,videoProcessing):[];
      const clipDirections=segments.length?`\n원본 ${video.durationSeconds}초 영상을 순서대로 정확히 3개의 독립 클립(0~${segments[0].to}초 / ${segments[1].from}~${segments[1].to}초 / ${segments[2].from}~${segments[2].to}초)으로 제공한다.
**segmentTranscripts는 반드시 세 객체(segmentIndex 0/1/2)를 작성**한다. 각 객체의 lines에는 해당 클립에서 실제 들리는 발언을 가능한 한 빠짐없이 발언별로 작성하라. 시작·끝 초는 **원본 시각이 아닌 해당 클립 시작을 0초로 놓은 클립 내부 상대 초**로 작성한다. 예: segmentIndex=2의 5초 발언은 startSeconds=5이지 원본 140초대가 아니다. 코드가 클립 시작을 더한다. 듣지 못한 발언을 생성하거나 앞 클립 문장을 재활용하지 말라. 2번(마지막 클립)도 실제로 살펴보고 결론까지 확인하라. 일반 transcript 배열은 중복 방지를 위해 []로 작성한다. summary/article/evidence/timeline은 전체 클립을 바탕으로 작성하되 녹취처럼 검증됐다고 주장하지 말라.\n`:'';
      const input=segments.length?
        [...clipVideoInputs(video.url,segments),{type:'text' as const,text:prompt+'\n'+detailInstructions+clipDirections}]:
        [{type:'video' as const,uri:video.url,processing:videoProcessing},{type:'text' as const,text:prompt+'\n'+detailInstructions}];
      const response=await interaction({key,model,requestId,pass:segments.length?'standard-segmented':'standard',format:segments.length?segmentedAnalysisFormat:analysisFormat,input,signal,timeoutMs:remainingMs,thinkingLevel:'low',maxOutputTokens:video.durationSeconds<300?12000:16000});
      const result=convert(response.parsed,video,model);
      if(segments.length){
        const segmented=parseSegmentedSpeech(response.parsed,segments);
        // Never fall back to the provider's global-time transcript when clipped
        // segments were requested: it reintroduces the observed 50-second drift.
        result.original.transcript=segmented.lines;
        console.info(JSON.stringify({event:'analysis.segmented_speech',requestId,clips:segments.map(s=>[s.from,s.to]),includedSegments:segmented.includedSegments,missingSegments:segmented.missingSegments,lines:segmented.lines.length,rejected:segmented.rejected,lastEnd:segmented.lines.at(-1)?.endSeconds??null}));
        if(segmented.missingSegments.length)result.original.exclusions.push(`영상 클립 ${segmented.missingSegments.map(x=>x+1).join(', ')}번의 발언 결과를 확보하지 못했습니다. 없는 음성을 생성하지 않았습니다.`);
      }
      const timelineBefore=result.original.timeline.length;
      let supplementalCalls=0;
      let supplementalAdded=0;
      // Speech-first: a model-provided utterance must NOT be overwritten by its separate
      // editorial summary. It is still an UNVERIFIED audio interpretation, not captions.
      result.original.transcript=dedupeInitialSpeech(result.original.transcript,video.durationSeconds);
      let speech=speechFirstTimeline(result.original.transcript,result.evidence,video.durationSeconds);
      const initialGaps=speech.timeline.length
        ? speechReviewWindows(result.original.transcript,video.durationSeconds)
        : [{from:0,to:video.durationSeconds}];
      // Ask only about the latest missing interval. Mixing many time windows
      // encouraged the provider to restamp final-minute speech near 00:02.
      const recoveryWindow=chooseSpeechRecoveryWindow(initialGaps,video.durationSeconds);
      if(recoverMissingSpeech && recoveryWindow.length){
        supplementalCalls++;
        onProgress({type:'progress',step:3,label:'누락된 음성 구간 보완',attempt:i+2,detail:`${Math.floor(recoveryWindow[0].from)}~${Math.floor(recoveryWindow[0].to)}초 구간을 확인합니다. Static은 영상 자체를 해당 구간으로 제한합니다. 무료 영상 요청 1회가 추가됩니다.`});
        try{
          const supplement=await interaction({key,model,requestId,pass:'speech-tail',format:speechTailFormat,
            input:[{type:'video',uri:video.url,processing:videoProcessing==='static'?{type:'static',start_offset:`${Math.floor(recoveryWindow[0].from)}s`,end_offset:`${Math.ceil(recoveryWindow[0].to)}s`}:'agentic'},{type:'text',text:focusedSpeechPrompt(video.durationSeconds,recoveryWindow)}],
            signal,timeoutMs:90000,thinkingLevel:'low',maxOutputTokens:5500});
          const added=mergeSupplementalSpeech(result.original.transcript,supplement.parsed,video.durationSeconds,recoveryWindow);
          supplementalAdded=added.added;
          result.original.transcript=added.lines;
          speech=speechFirstTimeline(result.original.transcript,result.evidence,video.durationSeconds);
          console.info(JSON.stringify({event:'analysis.speech_recovery',requestId,requestedWindow:recoveryWindow,added:supplementalAdded,rejected:added.rejected,rejectedOutOfWindow:added.rejectedOutOfWindow,lastEndSeconds:speech.lastEnd}));
          if(added.rejectedOutOfWindow) result.original.exclusions.push('추가 음성 분석에서 요청 시간대 밖의 발언 시각이 반환되어 폐기했습니다. 잘못된 시각을 타임라인에 추가하지 않았습니다.');
        }catch(speechError){
          if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
          console.warn(JSON.stringify({event:'analysis.speech_recovery_failed',requestId,code:speechError instanceof ServiceError?speechError.code:'PROVIDER_UNAVAILABLE'}));
          result.original.exclusions.push('누락된 구간의 음성 추가 확인에 실패했습니다. 기존에 확보한 발언만 표시합니다.');
        }
      }
      result.original.timeline=speech.timeline.length? speech.timeline
        : appendUnreferencedEvidenceNotes(timelineFromEvidenceNotes(result.original.timeline,result.evidence),result.evidence);
      if(speech.timeline.length)result.evidence=speech.evidence;
      // Unverified model declarations such as '03:10~03:22 no speech' are
      // not evidence of silence. Do not assert them as excluded facts.
      result.original.exclusions=result.original.exclusions.filter(text=>!/(발화\s*없음|음성\s*없음|무음|엔딩\s*카드|인트로\s*타이틀|아웃트로.*배경음악)/i.test(text));
      const unresolved=speech.timeline.length?speechReviewWindows(result.original.transcript,video.durationSeconds):[{from:0,to:video.durationSeconds}];
      if(!speech.timeline.length)result.original.exclusions.push('음성 발언 원문을 확보하지 못했습니다. 타임라인은 AI가 작성한 요약이며, 녹취록이 아닙니다.');
      if(initialGaps.some(w=>w.from>0&&w.to<video.durationSeconds&&w.to-w.from>=25))result.original.exclusions.push('중간 발언 근거가 길게 누락되어 이후 AI 추정 시각이 실제 영상과 밀렸을 수 있습니다. 자막 없는 URL 분석 결과는 시각을 검증하지 못했습니다.');
      if(unresolved.length)result.original.exclusions.push(`영상의 일부 발언 구간을 확인하지 못했습니다. 마지막 원문 근거 종료 ${Math.floor(speech.lastEnd??0)}초 / 전체 ${video.durationSeconds}초. 없는 발언을 채우지 않았습니다.`);
      console.info(JSON.stringify({event:'analysis.timeline_granularity',requestId,sourceMode:'video-url',before:timelineBefore,after:result.original.timeline.length,speechLines:speech.timeline.length,recoveryCalls:supplementalCalls,recovered:supplementalAdded,unresolvedWindows:unresolved}));
      const audit=assessSinglePassCoverage(result.evidence,result.original,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.time_coverage',requestId,model,missingEvidenceWindows:missingEvidenceWindows(result.evidence,video.durationSeconds),missingSpeechWindows:unresolved,timelineCount:result.original.timeline.length}));
      console.info(JSON.stringify({event:'analysis.timeline_time_review',requestId,sourceMode:'video-url',gaps:audit.timing.gaps,lastStartSeconds:audit.timing.lastStartSeconds,lastEndSeconds:audit.timing.lastEndSeconds,aiTimesUnverified:true}));
      result.analysisMeta={depth:'standard',videoProcessing,elapsedMs:Date.now()-analysisStarted,inputTokens:response.tokens.input??undefined,outputTokens:response.tokens.output??undefined,providerCalls:i+1+supplementalCalls,refinement:'not-needed',pipeline:'single-pass',qualityStatus:(audit.incomplete||unresolved.length>0||!speech.timeline.length)?'partial':'review',sourceEndPercent:audit.lastTimelinePercent};
      // Time review belongs in the timeline UI, not the list of excluded facts.
      // A provider-derived timecode cannot be certified against speech without captions.
      result.edited=structuredClone(result.original);
      onProgress({type:'progress',step:4,label:'타임라인 전체 구간 검사',detail:audit.needsReview?'세부 발언의 시간 근거를 원본과 대조해주세요.':'타임라인 시간 분포와 근거 구조를 확인했습니다.'});
      const quality=assessDetail(result.original,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'standard',videoProcessing,elapsedMs:Date.now()-analysisStarted,providerCalls:i+1+supplementalCalls,speechLines:speech.timeline.length,recoveredLines:supplementalAdded,missingSpeechWindows:unresolved,tokens:response.tokens,contentMetrics:quality.counts,shortFields:quality.shortFields}));
      return result;
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
      lastError=isTimeout(error)?new ServiceError('TIMEOUT','영상 분석 시간이 초과됐습니다.',504):error;
      if(lastError instanceof ServiceError && lastError.code==='TIMEOUT'){
        console.error(JSON.stringify({event:'analysis.provider_timeout',requestId,model,pass:segmentShortSpeech&&shortSpeechSegments(video.durationSeconds,videoProcessing).length?'standard-segmented':'standard',attempt:i+1,elapsedMs:Date.now()-attemptStarted,overallMs:Date.now()-analysisStarted,budgetMs:firstTimeoutMs}));
      }
      if(shouldRetryProviderBusy(lastError instanceof ServiceError?lastError.code:undefined,i,retryOnBusy)){
        if(!hasBasic503RetryBudget(basicDeadlineMs,Date.now())){
          console.warn(JSON.stringify({event:'analysis.standard_503_retry_skipped',requestId,model,reason:'insufficient_remaining_time',remainingMs:remainingBasicAnalysisMs(basicDeadlineMs,Date.now())}));
          break;
        }
        console.warn(JSON.stringify({event:'analysis.standard_503_retry',requestId,model,attempt:i+2,delayMs:BUSY_RETRY_DELAY_MS,remainingMs:remainingBasicAnalysisMs(basicDeadlineMs,Date.now())}));
        onProgress({type:'progress',step:2,attempt:i+2,label:'Google 503 · 재시도 대기',detail:'제공자 서버 혼잡으로 2.4초 대기 후 마지막 한 번 재시도합니다. 무료 API 요청 1회가 추가됩니다.'});
        try{await waitBeforeProviderRetry(signal);}catch{throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);}
        continue;
      }
      break;
    }
  }
  throw lastError instanceof ServiceError?lastError:new ServiceError('PROVIDER_UNAVAILABLE',lastError instanceof Error?lastError.message:'분석 요청에 실패했습니다.',502);
}
