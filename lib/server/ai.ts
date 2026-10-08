import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
import { FREE_MODEL } from '@/lib/server/personal-mode';
import type { AnalysisProgress } from '@/lib/analysis-stream';
import { googleErrorDetail,googleErrorMessage } from '@/lib/server/google-error';
import { assessDetail, detailTargets, needsDeepening, qualityDensityScore } from '@/lib/analysis-detail';
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

// One schema for both passes; no extra React/editor format conversion.
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

// The optional second call re-reads the actual video, rather than elaborating
// blindly on a potentially inaccurate first-pass draft.
async function deepenAnalysis(video: VideoInfo, first: AnalysisRecord, key: string, model: string, signal: AbortSignal | undefined, requestId: string) {
  const started = Date.now();
  const timeout = AbortSignal.timeout(75_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const guidance = `2차 원본 재검토: 다음 JSON은 같은 영상을 먼저 분석한 초안이다.
${JSON.stringify({evidence:first.evidence,summary:first.original.summary,timeline:first.original.timeline,article:first.original.article,exclusions:first.original.exclusions}).slice(0,38000)}
영상 처음부터 끝까지 다시 확인하여 사실관계와 시간 구간을 대조하고, 누락된 실질적 논점과 구체적 설명을 더한 JSON 결과를 전체 스키마로 새로 작성하라. 초안 내용이 실제 영상과 다르면 반드시 고쳐라.
매 타임라인 구간은 실제 영상에 존재하는 시각에 연결하고, 아티클 각 소제목에 서로 다른 논점·발화·사례를 2개 이상의 문단으로 설명하라. 근거 없는 문장이나 임의의 시간은 늘리지 마라. 제공 영상에서 충분히 확인하지 못하면 초안보다 짧아도 된다. transcript는 정확한 전사가 검증될 때만 작성하라.`;
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: {'Content-Type':'application/json','x-goog-api-key':key}, cache:'no-store', signal:combined,
    body: JSON.stringify({model,store:false,
      input:[{type:'text',text:prompt+'\n\n'+guidance},{type:'video',uri:video.url}],
      generation_config:{max_output_tokens:16000,thinking_level:'low'},response_format:analysisFormat}),
  });
  if (!response.ok) {
    const reason=googleErrorDetail(await response.text().catch(() => ''));
    console.warn(JSON.stringify({event:'analysis.refinement_unavailable',requestId,httpStatus:response.status,reason:reason.code,ms:Date.now()-started}));
    return null;
  }
  const data=await response.json() as InteractionResponse;
  if (data.status && data.status!=='completed') return null;
  const output=extractInteractionText(data);
  if (!output.trim()) return null;
  const result=convert(decodeJson(output),video,model);
  return {result, outputTokens:data.usage?.total_output_tokens??null, inputTokens:data.usage?.total_input_tokens??null, ms:Date.now()-started};
}

// This is a synchronous local-only PoC. Streaming *our own* status events lets
// the UI show network activity, even when Google sends no intermediate tokens.
// A provider-side % is not available; do not fabricate one.
const transientHttp = new Set([408, 500, 502, 503, 504]);
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message));
}
export async function analyzeVideo(
  video: VideoInfo,
  requestId: string,
  onProgress: (event: AnalysisProgress) => void,
  signal?: AbortSignal,
  depth: 'standard' | 'deep' = 'standard',
): Promise<AnalysisRecord> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ServiceError('NOT_CONFIGURED', 'Google AI Studio 무료 등급 API 키가 필요합니다.', 503);
  const model = FREE_MODEL;
  const startedAll = Date.now();
  const targets = detailTargets(video.durationSeconds);
  const detailInstructions = `영상 ${video.durationSeconds}초 분석 목표: 근거가 충분하다면 핵심 요약 ${targets.summary}~${targets.summary+2}항목, 세부 타임라인 ${targets.timeline}~${targets.timeline+5}항목, 상세 아티클 ${targets.article}~${targets.article+3}개 소제목으로 작성하세요. 각 요약 항목은 2~4문장, 타임라인은 구간마다 2~4문장, 아티클 소제목별 2~4문단으로 작성하세요. 같은 주장만 반복하지 말고 원본에 실제 등장한 서로 다른 내용으로 구성하세요. 영상에서 이만큼의 뚜렷한 내용을 확인할 수 없다면 숫자를 억지로 맞추지 말고 줄이세요. 짧더라도 사실과 영상 근거가 최우선입니다.`;

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
            { type: 'text', text: prompt + `\n\n${detailInstructions}\n영상 길이: ${video.durationSeconds}초. ID: ${video.id}.` },
            { type: 'video', uri: video.url },
          ],
          generation_config: { max_output_tokens: 16000, thinking_level: 'low' },
          response_format: analysisFormat,
        }),
      });
      if (!response.ok) {
        const details = googleErrorDetail(await response.text().catch(() => ''));
        console.error(JSON.stringify({event:'ai.http_error',requestId,model,attempt:attempt+1,httpStatus:response.status,providerReason:details.code,ms:Date.now()-started}));
        const explanation = googleErrorMessage(response.status, details);
        if (response.status === 429) throw new ServiceError('FREE_LIMIT', explanation, 429);
        if ([400,401,403,404].includes(response.status)) throw new ServiceError('GOOGLE_REQUEST_REJECTED', explanation, 502);
        if (!transientHttp.has(response.status)) throw new ServiceError('PROVIDER_UNAVAILABLE', explanation, 502);
        throw new ServiceError('TEMPORARY_HTTP', explanation, 502);
      }
      const data = await response.json() as InteractionResponse;
      // The synchronous API can still return a nonterminal status. Do not
      // mistake it for a completed analysis or blindly retry a running job.
      if (data.status && data.status !== 'completed') {
        const failure = ['failed','cancelled','incomplete','requires_action','in_progress','queued'].includes(data.status);
        if (failure) throw new ServiceError('INTERACTION_STATUS', `Gemini 응답 상태: ${data.status}${data.error?.message ? ` · ${googleErrorDetail(JSON.stringify({error:{status:data.error.code,message:data.error.message}})).detail}` : ''}. 완료된 결과를 받지 못했습니다.`, 502);
      }
      const output = extractInteractionText(data);
      if (!output.trim()) throw new ServiceError('INVALID_RESULT', 'Gemini 응답에서 분석 본문을 찾지 못했습니다. 영상 접근 또는 출력 한도를 확인해주세요.', 502);
      onProgress({type: 'progress',step: 3,label: 'AI 응답 수신',detail: '분석 내용을 받았습니다. 구조와 시간 근거를 확인하고 있습니다.'});
      let parsed: unknown;
      try { parsed = decodeJson(output); }
      catch { throw new ServiceError('INVALID_RESULT','Gemini 응답이 유효한 JSON이 아닙니다. 출력 토큰 한도를 확인해주세요.',502); }
      let result = convert(parsed, video, model);
      let extraCall = false;
      let improvement = false;
      // Max two provider calls overall: a retry replaces the refinement call.
      if (depth === 'deep' && attempt === 0 && needsDeepening(result.original, video.durationSeconds)) {
        extraCall = true;
        onProgress({type:'progress',step:3,attempt:2,label:'정밀 분석 · 영상 다시 검토',detail:'첫 결과의 빠진 논점과 근거를 다시 살피고 있습니다. 두 번째 무료 AI 호출을 사용합니다.'});
        try {
          const candidate = await deepenAnalysis(video, result, key, model, signal, requestId);
          if (candidate && qualityDensityScore(candidate.result.original,video.durationSeconds)>qualityDensityScore(result.original,video.durationSeconds)) {
            result=candidate.result;
            improvement=true;
          }
          console.info(JSON.stringify({event:'analysis.refinement_done',requestId,improved:improvement,extraOutputTokens:candidate?.outputTokens??null,extraInputTokens:candidate?.inputTokens??null,ms:candidate?.ms??null}));
        } catch (refineError) {
          if (signal?.aborted) throw new ServiceError('CANCELLED','분석이 중단되었습니다.',499);
          // Preserve the valid first pass when the optional second pass fails.
          console.warn(JSON.stringify({event:'analysis.refinement_failed',requestId,code:refineError instanceof ServiceError?refineError.code:'INVALID_OR_TIMEOUT'}));
          onProgress({type:'progress',step:3,label:'첫 분석 결과 사용',detail:'추가 검토를 완료하지 못했으므로 정상 생성된 첫 결과를 사용합니다.'});
        }
      }
      onProgress({type:'progress',step:4,label:'영상 근거 검증 완료',detail:'분석 결과를 브라우저로 전달합니다.'});
      result.analysisMeta={depth,providerCalls:attempt+1+(extraCall?1:0),refinement:extraCall?(improvement?'improved':'kept-first'):'not-needed'};
      const assessment = assessDetail(result.original, video.durationSeconds);
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,attempts:attempt+1,providerCalls:attempt+1+(extraCall?1:0),deepMode:depth==='deep',improved:improvement,ms:Date.now()-startedAll,inputTokens:data.usage?.total_input_tokens??null,outputTokens:data.usage?.total_output_tokens??null,contentMetrics:assessment.counts,shortFields:assessment.shortFields}));
      return result;
    } catch(error) {
      if (signal?.aborted) throw new ServiceError('CANCELLED','사용자가 분석을 중단했습니다.',499);
      const timedOut = isTimeout(error);
      lastError = timedOut ? new ServiceError('TIMEOUT',`Gemini 응답이 ${Math.round(timeoutMs[attempt]/1000)}초 안에 완료되지 않았습니다. 짧은 영상으로 먼저 확인하거나 나중에 다시 시도해주세요.`,504) : error;
      const code = lastError instanceof ServiceError ? lastError.code : 'TRANSIENT_ERROR';
      console.error(JSON.stringify({event:'analysis.attempt_failed',requestId,model,attempt:attempt+1,ms:Date.now()-started,code}));
      // Bad video / rate limits / malformed response are not helped by retrying.
      if (lastError instanceof ServiceError && !['TIMEOUT','TEMPORARY_HTTP'].includes(lastError.code)) throw lastError;
      if (attempt === 0) {
        onProgress({type:'progress',step:2,attempt:2,label:'일시적 오류 재시도 준비',detail:'첫 요청이 실패했습니다. 같은 무료 모델로 마지막 한 번만 재시도합니다.'});
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastError instanceof ServiceError ? lastError : new ServiceError('PROVIDER_UNAVAILABLE',lastError instanceof Error?`Gemini 연결 실패: ${lastError.message.slice(0,200)}`:'무료 AI 분석에 실패했습니다.',502);
}
