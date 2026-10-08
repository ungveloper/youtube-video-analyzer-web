import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
import { FREE_MODEL } from '@/lib/server/personal-mode';
import type { AnalysisProgress } from '@/lib/analysis-stream';
const prompt=`너는 YouTube 공개 영상을 한국어로 분석하는 근거 기반 분석기다.
규칙: 반드시 실제로 입력된 영상에서 검증 가능한 내용만 출력하라. 제목/설명만 보고 영상 내용을 추측하지 마라. 핵심 주장 하나마다 증거 구간 evidenceIds를 붙여라. 시간은 실제 영상 길이 내 초 단위. 근거 없는 주장/불확실한 수치/작은 글씨는 결과에서 제외하고 exclusions에 간략히 알려라. 모든 출력은 한국어로. 아티클은 이해하기 쉬운 상세 해설형으로 작성하되 외부 지식과 만들어낸 사례를 섞지 마라.
스크립트는 실제 원문 발화 자료를 충분히 확신할 수 있고 원문과 정확하게 일치하도록 추출할 수 있는 경우에만 작성하라. 외국어 원문을 확보했다면 문장을 한국어로 번역하고 translated=true로 설정하라. 실제 전사가 불가능하면 transcript=[] 로 둬라. 영상의 대사 전체를 상상해서 생성하지 마라.
JSON 한 개만 출력. 필수 스키마:
{"evidence":[{"id":"ev1","startSeconds":0,"endSeconds":10,"kind":"video","note":"관찰 근거"}],"summary":[{"id":"s1","text":"핵심 내용","evidenceIds":["ev1"]}],"timeline":[{"id":"t1","title":"주제","text":"상세 설명","evidenceIds":["ev1"]}],"article":[{"id":"a1","title":"소제목","text":"상세 해설 문단","evidenceIds":["ev1"]}],"transcript":[{"id":"tr1","startSeconds":0,"endSeconds":4,"text":"실제 확인한 발언 또는 번역","translated":false}],"exclusions":["확인할 수 없어 제외한 항목"]}
원문 스크립트가 없으면 transcript=[]로 반드시 표시. summary, timeline, article는 근거가 있는 경우에만 작성하라. 완성된 JSON 외에 어떤 문장도 출력하지 마라.`;
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

// This is a synchronous local-only PoC. Streaming *our own* status events lets
// the UI show network activity, even when Google sends no intermediate tokens.
// A provider-side % is not available; do not fabricate one.
const transientHttp = new Set([408, 500, 502, 503, 504]);
function safeProviderReason(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {error?: { status?: string; code?: number }};
    return parsed.error?.status?.replace(/[^A-Z_]/g, '').slice(0, 40) || 'UNKNOWN';
  } catch { return 'UNKNOWN'; }
}
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message));
}
export async function analyzeVideo(
  video: VideoInfo,
  requestId: string,
  onProgress: (event: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AnalysisRecord> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ServiceError('NOT_CONFIGURED', 'Google AI Studio 무료 등급 API 키가 필요합니다.', 503);
  const model = FREE_MODEL;
  const startedAll = Date.now();
  // Bound the maximum wait instead of leaving the UI in a permanent spinner.
  const timeoutMs = [110_000, 75_000];
  let lastError: unknown;
  for (let attempt = 0; attempt < timeoutMs.length; attempt++) {
    if (signal?.aborted) throw new ServiceError('CANCELLED', '분석이 중단되었습니다.', 499);
    const started = Date.now();
    onProgress({type: 'progress', step: 2, attempt: attempt + 1, label: attempt ? '무료 AI 다시 연결 중' : 'Gemini 영상 분석 중', detail: attempt ? '일시적인 연결 오류로 마지막 한 번만 다시 시도합니다.' : '영상의 길이에 따라 다소 시간이 걸립니다. 실제 AI 내부 진행률은 제공되지 않습니다.'});
    try {
      const timeout = AbortSignal.timeout(timeoutMs[attempt]);
      const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        cache: 'no-store',
        signal: fetchSignal,
        body: JSON.stringify({
          model,
          store: false,
          input: [
            { type: 'text', text: prompt + `\n영상 길이: ${video.durationSeconds}초. ID: ${video.id}. 실제 영상 근거가 불충분하면 해당 내용을 생성하지 마라.` },
            { type: 'video', uri: video.url },
          ],
          generation_config: { temperature: 0.2, max_output_tokens: 10000 },
          response_format: {
            type: 'text', mime_type: 'application/json',
            schema: {
              type: 'object',
              properties: {
                evidence: { type: 'array', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, kind: {type: 'string'}, note: {type: 'string'}}, required: ['id','startSeconds','endSeconds','kind'] } },
                summary: { type: 'array', items: { type: 'object', properties: {id: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','text','evidenceIds'] } },
                timeline: { type: 'array', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                article: { type: 'array', items: { type: 'object', properties: {id: {type: 'string'}, title: {type: 'string'}, text: {type: 'string'}, evidenceIds: {type: 'array',items: {type: 'string'}}}, required: ['id','title','text','evidenceIds'] } },
                transcript: { type: 'array', items: { type: 'object', properties: {id: {type: 'string'}, startSeconds: {type: 'number'}, endSeconds: {type: 'number'}, text: {type: 'string'}, translated: {type: 'boolean'}}, required: ['id','startSeconds','endSeconds','text','translated'] } },
                exclusions: {type: 'array', items: {type: 'string'}},
              }, required: ['evidence','summary','timeline','article','transcript','exclusions'],
            },
          },
        }),
      });
      if (!response.ok) {
        const reason = safeProviderReason(await response.text().catch(() => ''));
        console.error(JSON.stringify({event:'ai.http_error',requestId,model,attempt:attempt+1,httpStatus:response.status,providerReason:reason,ms:Date.now()-started}));
        const suffix = `Google API HTTP ${response.status} (${reason})`;
        if (response.status === 429) throw new ServiceError('FREE_LIMIT', `무료 AI 요청 한도가 소진됐습니다. ${suffix}. 유료 모델로 전환하지 않습니다.`, 429);
        if ([400,401,403,404].includes(response.status)) throw new ServiceError('SOURCE_UNAVAILABLE', `영상 URL, 무료 프로젝트 또는 모델 지원 여부를 확인해주세요. ${suffix}`, 502);
        if (!transientHttp.has(response.status)) throw new ServiceError('PROVIDER_UNAVAILABLE', `AI 제공자가 요청을 거부했습니다. ${suffix}`, 502);
        throw new Error(`일시적인 Google API 오류: ${suffix}`);
      }
      const data = await response.json() as InteractionResponse;
      // The synchronous API can still return a nonterminal status. Do not
      // mistake it for a completed analysis or blindly retry a running job.
      if (data.status && data.status !== 'completed') {
        const failure = ['failed','cancelled','incomplete','requires_action','in_progress','queued'].includes(data.status);
        if (failure) throw new ServiceError('INTERACTION_STATUS', `Gemini 응답 상태가 ${data.status}입니다. 완료된 분석 결과를 받지 못했습니다. 요청 ID: ${requestId.slice(0,8)}.`, 502);
      }
      const output = extractInteractionText(data);
      if (!output.trim()) throw new ServiceError('INVALID_RESULT', 'Gemini 응답에서 분석 본문을 찾지 못했습니다. 영상 접근 또는 출력 한도를 확인해주세요.', 502);
      onProgress({type: 'progress',step: 3,label: 'AI 응답 수신',detail: '분석 내용을 받았습니다. 구조와 시간 근거를 확인하고 있습니다.'});
      let parsed: unknown;
      try { parsed = decodeJson(output); }
      catch { throw new ServiceError('INVALID_RESULT','Gemini 응답이 유효한 JSON이 아닙니다. 출력 토큰 한도를 확인해주세요.',502); }
      const result = convert(parsed, video, model);
      onProgress({type:'progress',step:4,label:'영상 근거 검증 완료',detail:'분석 결과를 브라우저로 전달합니다.'});
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,attempts:attempt+1,ms:Date.now()-startedAll,inputTokens:data.usage?.total_input_tokens??null,outputTokens:data.usage?.total_output_tokens??null}));
      return result;
    } catch(error) {
      if (signal?.aborted) throw new ServiceError('CANCELLED','사용자가 분석을 중단했습니다.',499);
      const timedOut = isTimeout(error);
      lastError = timedOut ? new ServiceError('TIMEOUT',`Gemini 응답이 ${Math.round(timeoutMs[attempt]/1000)}초 안에 완료되지 않았습니다. 짧은 영상으로 먼저 확인하거나 나중에 다시 시도해주세요.`,504) : error;
      const code = lastError instanceof ServiceError ? lastError.code : 'TRANSIENT_ERROR';
      console.error(JSON.stringify({event:'analysis.attempt_failed',requestId,model,attempt:attempt+1,ms:Date.now()-started,code}));
      // Bad video / rate limits / malformed response are not helped by retrying.
      if (lastError instanceof ServiceError && !['TIMEOUT'].includes(lastError.code)) throw lastError;
      if (attempt === 0) {
        onProgress({type:'progress',step:2,attempt:2,label:'일시적 오류 재시도 준비',detail:'첫 요청이 실패했습니다. 같은 무료 모델로 마지막 한 번만 재시도합니다.'});
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastError instanceof ServiceError ? lastError : new ServiceError('PROVIDER_UNAVAILABLE',lastError instanceof Error?`Gemini 연결 실패: ${lastError.message.slice(0,200)}`:'무료 AI 분석에 실패했습니다.',502);
}
