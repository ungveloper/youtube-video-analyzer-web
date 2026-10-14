/** Speech-only analysis: separately process genuine static video clips.
 * Do not reinterpret clip-relative seconds as original-video seconds.
 * No transcript from Gemini is equivalent to verified timed subtitles.
 */
import type {TranscriptLine} from './types';
import type {SourceMap} from './server/evidence-pipeline';
import {clipProcessing,parseSegmentedSpeech,type SpeechSegment} from './segmented-speech';
import {speechReviewWindows,type SpeechReviewWindow} from './speech-timeline';

export function makeSpeechClipRequest(uri:string,segment:SpeechSegment){
  const coreFrom=segment.coreFrom??segment.from;
  const coreTo=segment.coreTo??segment.to;
  const localFrom=coreFrom-segment.from;
  const localTo=coreTo-segment.from;
  return [{type:'video' as const,uri,processing:clipProcessing(segment)},
    {type:'text' as const,text:`이 입력은 원본 영상 ${segment.from}~${segment.to}초 부분만 담은 STATIC 영상 클립이다. 이 클립을 직접 듣고 실제 발언을 원래의 어순대로 한국어로 받아써라. 출력은 요약·해설·제목이 아닌 발화 전사만 포함한다.
클립 앞뒤에는 이웃 문장이 끊기지 않도록 몇 초의 문맥이 있다. **전사 대상은 원본 ${coreFrom}초 이상 ~ ${coreTo}초 미만에 시작하는 문장들만**이다. 클립 기준으로는 ${localFrom}초 이상 ~ ${localTo}초 미만에 시작하는 문장이다. 클립 시작 전/끝 이후 발언을 만들지 말고 앞뒤 문맥의 이미 다른 구간에 배정된 문장을 중복 작성하지 마라. 전사 대상 구간에서 시작해 클립 문맥 영역까지 이어진 실제 문장은 끝까지 기록한다.
발언들을 빠짐없이 시간순으로 전사하며, 각 lines 항목은 완결된 실제 발화 문장 하나를 원칙으로 한다. 말하는 도중 2~3초씩 임의로 쪼개지 마라. 예: “마치 오래된 상수도 / 안쪽에 때가 끼어 쌓여서 점점 / 좁아지는 것과 같습니다”는 하나의 문장이다. 단, 실제 별개로 끝난 문장이나 질문은 별도 항목이다. 짧은 질문/연결 문장을 건너뛰지 말고 처음부터 끝까지 듣되 들리지 않은 말은 만들지 마라. 정확히 들리지 않는 단어나 발언은 지어내지 마라.
startSeconds/endSeconds는 **이번 클립의 시작이 0초인 상대시간**이며 원본 동영상 절대 시간이 아니다. 반드시 소리와 해당 문장 시작의 위치를 대조하라. 정밀하지 않은 시간을 임의로 균등 배치하지 마라. 응답은 JSON 객체 {"lines":[{"startSeconds":0,"endSeconds":3,"text":"실제 들린 말"}]}만 작성하라.`}];
}

export type ClipResult = {segment:SpeechSegment;parsed?:unknown;failure?:string};
export function collectSpeechClipResults(outcomes:ClipResult[],segments:SpeechSegment[]):{
  lines:TranscriptLine[];coveredSegments:number[];failedSegments:number[];missingWindows:SpeechReviewWindow[];rejected:number;
}{
  const clips=outcomes.flatMap(o=>o.parsed? [{segmentIndex:o.segment.index,lines:(o.parsed as {lines?:unknown}).lines}]:[]);
  const parsed=parseSegmentedSpeech({segmentTranscripts:clips},segments);
  const coveredSegments=segments.filter(s=>parsed.includedSegments.includes(s.index)&&parsed.lines.some(l=>l.startSeconds>=(s.coreFrom??s.from)&&l.startSeconds<(s.coreTo??s.to))).map(s=>s.index);
  const failedSegments=segments.filter(s=>!coveredSegments.includes(s.index)).map(s=>s.index);
  const missing=speechReviewWindows(parsed.lines,segments.at(-1)?.to??0);
  // If the provider returned an empty segment, its entire interval is unknown.
  const windows=[...missing,...segments.filter(s=>failedSegments.includes(s.index)).map(s=>({from:s.from,to:s.to}))]
    .sort((a,b)=>a.from-b.from);
  const merged:SpeechReviewWindow[]=[];
  for(const w of windows){
    if(!merged.length || w.from>merged[merged.length-1].to){merged.push({...w});}
    else merged[merged.length-1].to=Math.max(merged[merged.length-1].to,w.to);
  }
  return {lines:parsed.lines,coveredSegments,failedSegments,missingWindows:merged,rejected:parsed.rejected};
}

export function speechSource(lines:TranscriptLine[],duration:number):SourceMap {
  const ordered=[...lines].filter(l=>l.startSeconds>=0&&l.endSeconds<=duration&&l.endSeconds>l.startSeconds).sort((a,b)=>a.startSeconds-b.startSeconds);
  const evidence=ordered.map((l,i)=>({id:`speech-e-${i}`,startSeconds:l.startSeconds,endSeconds:l.endSeconds,kind:'audio' as const,note:l.text}));
  const claims=ordered.map((l,i)=>({id:`speech-c-${i}`,text:l.text,evidenceIds:[evidence[i].id],category:'영상 발언'}));
  return {evidence,claims,transcript:ordered,exclusions:[]};
}
export function formatMissingWindows(windows:SpeechReviewWindow[]):string {
  const time=(s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  return windows.map(w=>`${time(w.from)}~${time(w.to)}`).join(', ');
}
