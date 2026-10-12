import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
import { FREE_MODEL, type FreeModelId } from '@/lib/free-models';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import { googleErrorDetail,googleErrorMessage } from '@/lib/server/google-error';
import { assessDetail, detailTargets } from '@/lib/analysis-detail';
import { parseSourceMap, extractComposedContent, fallbackFromSource, sourceMapPrompt, composePrompt, sourceResponseFormat, composedResponseFormat } from '@/lib/server/evidence-pipeline';
import { sourceFromUserCaptions, trustedCaptionClaims, captionClaimPrompt } from '@/lib/server/caption-source';
import { assessSourceCoverage, includeMissingCaptionTimeline } from '@/lib/quality-audit';
// Single-call, source-grounded editorial instructions. Detail varies with video length;
// targets are aspirational and must never override source accuracy.
const prompt = `너는 교육·지식 콘텐츠 전문 한국어 영상 분석 편집자다. 입력한 YouTube 영상 자체를 분석하여 사용자가 영상 없이도 논지, 설명 과정, 구체적인 근거를 이해할 수 있는 고밀도 해설을 작성한다.

절대 원칙:
- 반드시 입력 영상에서 실제 확인할 수 있는 정보만 사용한다. 영상 제목·썸네일·설명만으로 내용을 상상하거나 일반 상식으로 문단을 채우지 않는다.
- 수치·인물·증상·의학/법률/금융적 효과·인과관계는 영상 속 발화/장면으로 확인할 때만 명시한다. 발표자의 주장과 객관적으로 검증된 사실을 구별한다.
- 설명되지 않은 외부 사실, 추측 사례, 근거 없는 도표, 통계, 임의 타임스탬프를 생성하지 않는다.
- 동일 내용을 다른 표현으로 늘어놓지 않는다. 반복 발언은 한 번 정리하되 서로 다른 논점은 누락하지 않는다.
- 모든 요약 항목/타임라인 항목/아티클 소제목에는 실제 영상 구간의 evidenceIds를 1개 이상 연결한다. 근거 시간은 0초~영상 길이 범위 내 실제 장면/발화에 가깝게 한다. 근거를 못 찾으면 해당 주장은 제외한다.

진행 방식:
1) 전체 영상을 시작부터 끝까지 따라가며 발화/화면에 등장한 주장, 예시, 정의, 경고, 결론과 주제 변화 지점을 찾는다.
2) evidence 배열에 확인 가능한 구간을 기록한다. 한 구간을 여러 주장에 재사용해도 된다. 실제 장면 시각과 다르게 시간을 채우기 위해 구간을 쪼개지는 않는다.
3) summary는 **서로 구분되는 핵심 주장**별 항목 목록으로 작성한다. text 각각 2~4문장으로 '무엇을 말했는지 / 영상에서 어떻게 설명했는지'를 담는다. 하나의 summary 항목에 전체 영상을 압축하지 않는다.
4) timeline은 시간순으로 주제 전환, 새로운 주장, 예시 및 결론을 최대한 촘촘하게 나눈다. title은 고유한 주제, text는 그 순간의 실제 내용과 설명 흐름을 2~4문장으로 구체적으로 설명한다. 단순 '소개·설명·마무리' 등의 제목만 반복하지 않는다.
5) article은 짧은 요약문이 아니라 영상에 기반한 **독립적으로 읽기 쉬운 상세 해설 아티클**이다. 도입→개념/문제→세부 논거·사례→주의점·결론의 실제 순서를 따르고, 소제목별 text에는 2~4개 문단(문단 사이 \n\n), 문단별 2~4문장 정도의 충분한 해설을 작성한다. 영상에 내용이 부족한 소제목은 짧게 유지한다. 영상에서 쓰는 용어를 설명하되 외부 사실을 섞지 않는다.
6) transcript는 원본 발화를 정확히 확인할 수 있는 경우에만 작성한다. 외국어 발화는 원문을 확보한 경우 한국어 번역과 translated=true. 정확한 전사/발화 시점을 확인할 수 없으면 []로 비운다. 영상 대사를 추측하여 구성하거나 요약문을 스크립트라고 부르지 않는다.
7) exclusions에는 확인할 수 없는 주요 정보/제약만 구체적으로 적는다. 특별히 없으면 []로 둔다. 상투적인 면책 문구로 길이를 채우지 않는다.

모든 출력은 한국어로, JSON 객체 한 개만 출력한다. summary/timeline/article는 각각 서로 구별되는 내용을 충분한 항목으로 작성한다. 제공된 JSON Schema 구조를 따른다.`;
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
                evidence: { type: 'array', description: '각 주장과 연결할 실제 영상 구간. 근거 없는 구간은 만들지 마세요.', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, kind: {type: 'string'}, note: {type: 'string'}}, required: ['id','startSeconds','endSeconds','kind'] } },
                summary: { type: 'array', description: '핵심 주장별 분리된 상세 요약 목록. 각 text는 여러 문장.', items: { type: 'object', properties: {id: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','text','evidenceIds'] } },
                timeline: { type: 'array', description: '내용 변화 시점별 실제 세부 타임라인. 각 text는 2~4문장.', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
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
async function interaction(args:{key:string;model:FreeModelId;input:Array<{type:'text';text:string}|{type:'video';uri:string}>;format:unknown;signal?:AbortSignal;timeoutMs:number;requestId:string;pass:string;thinkingLevel?:'low'|'medium'}) {
  const timeout=AbortSignal.timeout(args.timeoutMs);
  const signal=args.signal?AbortSignal.any([args.signal,timeout]):timeout;
  const started=Date.now();
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':args.key},
    cache:'no-store',signal,
    body:JSON.stringify({model:args.model,store:false,input:args.input,generation_config:{max_output_tokens:16000,thinking_level:args.thinkingLevel??(args.model==='gemini-3.8-flash'?'medium':'low')},response_format:args.format}),
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
  return {parsed,tokens:{input:data.usage?.total_input_tokens??null,output:data.usage?.total_output_tokens??null},ms:Date.now()-started};
}
function recordFromContent(video:VideoInfo,model:string,evidence:Evidence[],content:AnalysisContent):AnalysisRecord {
  const now=new Date().toISOString();
  return {id:crypto.randomUUID(),video,createdAt:now,updatedAt:now,model,evidence,original:content,edited:structuredClone(content)};
}
async function deepAnalysis(video:VideoInfo,model:FreeModelId,key:string,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,captionText?:string):Promise<AnalysisRecord>{
  // Source extraction is the expensive video-bearing request. Most analyses
  // use exactly two provider calls (video + text). On transient 5xx/timeouts,
  // retry ONLY this step once, retaining the user-selected model. In that case
  // deep mode uses at most three calls; never auto-switch to a paid model.
  let stage1: Awaited<ReturnType<typeof interaction>> | null = null;
  let sourceCalls = 0;
  const provided = captionText?.trim() ? sourceFromUserCaptions(captionText,video) : null;
  for (let retry = 0; retry < 2; retry++) {
    if (signal?.aborted) throw new ServiceError('CANCELLED', '분석이 중단되었습니다.', 499);
    sourceCalls++;
    onProgress({
      type:'progress',step:2,attempt:sourceCalls,
      label:retry===0?'1/2 · 영상 근거 추출':'1/2 · 영상 근거 추출 재시도',
      detail:retry===0
        ? '원본 영상에서 근거를 추출합니다. 모델 내부 처리율은 확인할 수 없습니다.'
        : 'Google의 일시적 오류로 잠시 기다린 뒤 한 번만 재시도합니다. 정상 2회 대신 최대 3회 호출될 수 있습니다.',
    });
    try {
      stage1=await interaction({
        key,model,requestId,pass:provided?'caption-claims':'source-map',format:sourceResponseFormat,
        input:provided?[{type:'text',text:captionClaimPrompt(provided)}]:[{type:'text',text:sourceMapPrompt(video.durationSeconds)},{type:'video',uri:video.url}],
        signal,timeoutMs:125000,
        // Video extraction is simpler than final composition; lower thinking
        // reduces reasoning overhead without changing the selected model.
        thinkingLevel:'low',
      });
      break;
    } catch (error) {
      if (signal?.aborted) throw new ServiceError('CANCELLED', '분석이 중단되었습니다.', 499);
      const converted=isTimeout(error)
        ? new ServiceError('TIMEOUT','영상 근거 추출 시간이 초과됐습니다.',504)
        : error;
      const retryable=(converted instanceof ServiceError && ['TEMPORARY_HTTP','TIMEOUT'].includes(converted.code))
        || (converted instanceof Error && !(converted instanceof ServiceError) && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(converted.message));
      if (retry===0 && retryable) {
        console.warn(JSON.stringify({event:'analysis.source_retry_scheduled',requestId,model,afterAttempt:sourceCalls,code:converted instanceof ServiceError?converted.code:'NETWORK_ERROR'}));
        await new Promise<void>(resolve=>setTimeout(resolve,1400));
        continue;
      }
      if (converted instanceof ServiceError && converted.code==='TEMPORARY_HTTP') {
        throw new ServiceError('PROVIDER_TEMPORARY',
          `선택한 ${model} 모델의 영상 입력 처리에서 Google 서버 오류가 ${sourceCalls}회 발생했습니다. 잠시 후 다시 시도하거나, 화면에서 Gemini 3.5 Flash-Lite를 직접 선택해 비교해주세요. 자동 유료 모델 전환은 하지 않습니다. 마지막 오류: ${converted.message}`,502);
      }
      if (provided && retry===1 && retryable) {
        console.warn(JSON.stringify({event:'analysis.caption_claims_fallback',requestId,model,reason:'MODEL_TRANSIENT'}));
        break; // The deterministic timed-caption evidence still exists.
      }
      throw converted;
    }
  }
  if (!stage1 && !provided) throw new ServiceError('PROVIDER_UNAVAILABLE','근거 추출 결과가 없습니다.',502);
  let source;
  try { source=provided?(stage1?trustedCaptionClaims(stage1.parsed,provided):provided):parseSourceMap(stage1!.parsed,video); }
  catch(error){throw new ServiceError('INVALID_SOURCE_MAP',error instanceof Error?error.message:'원본 근거를 추출하지 못했습니다.',502);}
  onProgress({type:'progress',step:3,attempt:sourceCalls+1,label:'2/2 · 상세 문서 작성',detail:`AI가 ${source.claims.length}개 논점과 ${source.evidence.length}개 시간 근거를 추출했습니다. 근거에 연결된 상세 문서를 작성합니다.`});
  let content:AnalysisContent;
  let composed=false;
  let stage2tokens:null|{input:number|null;output:number|null}=null;
  try {
    // Pass 2 is text only. No second video ingestion and no ability to add source claims.
    const stage2=await interaction({key,model,requestId,pass:'compose',format:composedResponseFormat,input:[{type:'text',text:composePrompt(source,video.durationSeconds)}],signal,timeoutMs:125000});
    content=extractComposedContent(stage2.parsed,source);
    composed=true;
    stage2tokens=stage2.tokens;
  } catch(error) {
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
    // The first step has original, bounded evidence: show that source only,
    // transparently labeled as a reduced result. Never fabricate the rest.
    console.warn(JSON.stringify({event:'analysis.compose_fallback',requestId,model,code:error instanceof ServiceError?error.code:'INVALID_OR_TIMEOUT'}));
    content=fallbackFromSource(source);
    onProgress({type:'progress',step:3,label:'근거 추출 결과 제공',detail:'상세 문서 생성에 실패하여 1차 근거 요지를 안전하게 표시합니다.'});
  }
  if(provided) content=includeMissingCaptionTimeline(source,content);
  const audit=assessSourceCoverage(source,content,video.durationSeconds,composed);
  if(audit.qualityStatus==='partial') content.exclusions.push('근거 또는 설명 범위가 충분하지 않아 이 결과는 부분 분석입니다. 실제 영상과 대조해주세요.');
  const result=recordFromContent(video,model,source.evidence,content);
  result.analysisMeta={depth:'deep',providerCalls:sourceCalls+1,refinement:composed?'improved':'kept-first',pipeline:'evidence-compose',sourceClaims:source.claims.length,sourceEvidence:source.evidence.length, sourceMode:provided?'user-captions':'video-url', qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent};
  onProgress({type:'progress',step:4,label:'근거 연결 검사 완료',detail:'존재하는 근거 ID·시간 범위를 확인했습니다. 사실 일치는 원본 대조가 필요합니다.'});
  const quality=assessDetail(content,video.durationSeconds);
  console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'deep',pipeline:'evidence-compose',providerCalls:sourceCalls+1,sourceCalls,composed,sourceClaims:source.claims.length,sourceEvidence:source.evidence.length,firstInputTokens:stage1?.tokens.input??null,firstOutputTokens:stage1?.tokens.output??null,secondTokens:stage2tokens,contentMetrics:quality.counts,shortFields:quality.shortFields,sourceMode:result.analysisMeta.sourceMode,qualityStatus:audit.qualityStatus,coveragePercent:audit.coveragePercent}));
  return result;
}
export async function analyzeVideo(video:VideoInfo,requestId:string,onProgress:(event:AnalysisProgress)=>void,signal?:AbortSignal,depth:'standard'|'deep'='standard',model:FreeModelId=FREE_MODEL,captionText?:string):Promise<AnalysisRecord>{
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new ServiceError('NOT_CONFIGURED','Google AI Studio 무료 등급 API 키가 필요합니다.',503);
  if(depth==='deep' || captionText?.trim())return deepAnalysis(video,model,key,requestId,onProgress,signal,captionText);
  const targets=detailTargets(video.durationSeconds);
  const detailInstructions=`영상 ${video.durationSeconds}초: 근거가 충분하면 요약 ${targets.summary}개 이상, 타임라인 ${targets.timeline}개 이상, 아티클 소제목 ${targets.article}개 이상을 목표로 하되 근거 없는 내용은 절대 생성하지 마라.`;
  const attempts=[110000,75000];let lastError:unknown;
  for(let i=0;i<attempts.length;i++){
    if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
    onProgress({type:'progress',step:2,attempt:i+1,label:i?'일시적 오류 재시도':'기본 영상 분석',detail:'영상에서 근거를 찾고 한국어 결과물을 생성하고 있습니다.'});
    try {
      const response=await interaction({key,model,requestId,pass:'standard',format:analysisFormat,input:[{type:'text',text:prompt+'\n'+detailInstructions},{type:'video',uri:video.url}],signal,timeoutMs:attempts[i]});
      const result=convert(response.parsed,video,model);
      result.analysisMeta={depth:'standard',providerCalls:i+1,refinement:'not-needed',pipeline:'single-pass'};
      onProgress({type:'progress',step:4,label:'결과 구조 검증 완료',detail:'영상 근거 구조와 시간 범위를 확인했습니다.'});
      const quality=assessDetail(result.original,video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,depth:'standard',providerCalls:i+1,tokens:response.tokens,contentMetrics:quality.counts,shortFields:quality.shortFields}));
      return result;
    }catch(error){
      if(signal?.aborted)throw new ServiceError('CANCELLED','분석이 중단됐습니다.',499);
      lastError=isTimeout(error)?new ServiceError('TIMEOUT','영상 분석 시간이 초과됐습니다.',504):error;
      if(!(lastError instanceof ServiceError)||!['TEMPORARY_HTTP','TIMEOUT'].includes(lastError.code)||i===1)break;
    }
  }
  throw lastError instanceof ServiceError?lastError:new ServiceError('PROVIDER_UNAVAILABLE',lastError instanceof Error?lastError.message:'분석 요청에 실패했습니다.',502);
}
