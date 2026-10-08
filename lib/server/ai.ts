import 'server-only';
import type { AnalysisContent,AnalysisRecord,Evidence,GroundedItem,TranscriptLine,VideoInfo } from '@/lib/types';
import { ServiceError } from '@/lib/server/video';
const prompt=`너는 YouTube 공개 영상을 한국어로 분석하는 근거 기반 분석기다.
규칙: 반드시 실제로 입력된 영상에서 검증 가능한 내용만 출력하라. 제목/설명만 보고 영상 내용을 추측하지 마라. 핵심 주장 하나마다 증거 구간 evidenceIds를 붙여라. 시간은 실제 영상 길이 내 초 단위. 근거 없는 주장/불확실한 수치/작은 글씨는 결과에서 제외하고 exclusions에 간략히 알려라. 모든 출력은 한국어로. 아티클은 이해하기 쉬운 상세 해설형으로 작성하되 외부 지식과 만들어낸 사례를 섞지 마라.
스크립트는 실제 원문 발화 자료를 충분히 확신할 수 있고 원문과 정확하게 일치하도록 추출할 수 있는 경우에만 작성하라. 외국어 원문을 확보했다면 문장을 한국어로 번역하고 translated=true로 설정하라. 실제 전사가 불가능하면 transcript=[] 로 둬라. 영상의 대사 전체를 상상해서 생성하지 마라.
JSON 한 개만 출력. 필수 스키마:
{"evidence":[{"id":"ev1","startSeconds":0,"endSeconds":10,"kind":"video","note":"관찰 근거"}],"summary":[{"id":"s1","text":"핵심 내용","evidenceIds":["ev1"]}],"timeline":[{"id":"t1","title":"주제","text":"상세 설명","evidenceIds":["ev1"]}],"article":[{"id":"a1","title":"소제목","text":"상세 해설 문단","evidenceIds":["ev1"]}],"transcript":[{"id":"tr1","startSeconds":0,"endSeconds":4,"text":"실제 확인한 발언 또는 번역","translated":false}],"exclusions":["확인할 수 없어 제외한 항목"]}
원문 스크립트가 없으면 transcript=[]로 반드시 표시. summary, timeline, article는 근거가 있는 경우에만 작성하라. 완성된 JSON 외에 어떤 문장도 출력하지 마라.`;
type RawResponse={candidates?:{content?:{parts?:{text?:string}[]}}[];usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;totalTokenCount?:number};error?:{message?:string}};
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
function estimateCost(usage:RawResponse['usageMetadata']):number|null{
  const inRate=process.env.AI_INPUT_USD_PER_1M_TOKENS?.trim();
  const outRate=process.env.AI_OUTPUT_USD_PER_1M_TOKENS?.trim();
  if(!inRate||!outRate||!usage||usage.promptTokenCount===undefined||usage.candidatesTokenCount===undefined)return null;
  const a=Number(inRate),b=Number(outRate);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)return null;
  return Number(((usage.promptTokenCount*a+usage.candidatesTokenCount*b)/1000000).toFixed(6));
}
function decodeJson(value:string){const data=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');return JSON.parse(data) as unknown;}
export async function analyzeVideo(video:VideoInfo,requestId:string):Promise<AnalysisRecord>{
  const key=process.env.GEMINI_API_KEY;if(!key)throw new ServiceError('PROVIDER_UNAVAILABLE','무료 AI 제공자가 구성되지 않았습니다.',503);
  const primary=process.env.GEMINI_MODEL||'gemini-2.5-flash';const fallback=process.env.GEMINI_FALLBACK_MODEL;
  const models=[primary,fallback||primary];let lastError:unknown;
  for(let attempt=0;attempt<2;attempt++){
    const model=models[attempt];const start=Date.now();
    try{
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},cache:'no-store',signal:AbortSignal.timeout(attempt===0?175000:85000),
        body:JSON.stringify({contents:[{role:'user',parts:[{fileData:{fileUri:video.url,mimeType:'video/*'}},{text:prompt+`\n원본 길이: ${video.durationSeconds}초. 영상 ID: ${video.id}`}]}],generationConfig:{responseMimeType:'application/json',temperature:0.2,maxOutputTokens:8192}}),
      });
      if(!response.ok){const transient=[408,429,500,502,503,504].includes(response.status);console.error(JSON.stringify({event:'ai.http_error',requestId,model,attempt:attempt+1,httpStatus:response.status,durationMs:Date.now()-start}));if(!transient)throw new ServiceError('SOURCE_UNAVAILABLE',response.status===400?'해당 영상은 이 AI 모델에서 분석할 수 없습니다.':'AI 제공자가 이 영상 요청을 거부했습니다.',502);throw new Error(`AI temporary HTTP ${response.status}`);}
      const data=await response.json() as RawResponse;
      const text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
      if(!text)throw new Error('AI empty response');
      const result=convert(decodeJson(text),video,model);
      console.info(JSON.stringify({event:'analysis.completed',requestId,model,attempts:attempt+1,durationMs:Date.now()-start,inputTokens:data.usageMetadata?.promptTokenCount??null,outputTokens:data.usageMetadata?.candidatesTokenCount??null,estimatedCostUsd:estimateCost(data.usageMetadata)}));
      return result;
    }catch(error){lastError=error;console.error(JSON.stringify({event:'analysis.attempt_failed',requestId,model,attempt:attempt+1,durationMs:Date.now()-start,code:error instanceof ServiceError?error.code:'TEMPORARY_ERROR'}));if(error instanceof ServiceError&&error.code==='SOURCE_UNAVAILABLE')throw error;
      if(attempt===0)await new Promise(resolve=>setTimeout(resolve,900));
    }
  }
  throw lastError instanceof ServiceError?lastError:new ServiceError('PROVIDER_UNAVAILABLE','AI 분석 요청이 2회 연속 실패했습니다. 무료 이용 횟수는 반환됩니다.',502);
}
