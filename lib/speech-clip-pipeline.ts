/** Speech-only analysis: separately process genuine static video clips.
 * Do not reinterpret clip-relative seconds as original-video seconds.
 * No transcript from Gemini is equivalent to verified timed subtitles.
 */
import type {TranscriptLine} from './types';
import type {SourceMap} from './server/evidence-pipeline';
import {clipProcessing,parseSegmentedSpeech,type SpeechSegment} from './segmented-speech';
import {speechReviewWindows,type SpeechReviewWindow} from './speech-timeline';

export function makeSpeechClipRequest(uri:string,segment:SpeechSegment){
  return [{type:'video' as const,uri,processing:clipProcessing(segment)},
    {type:'text' as const,text:`이 입력은 원본 YouTube 영상의 ${segment.from}초~${segment.to}초 구간만 포함한다. 영상 전체 요약, 기사, 제목, 타임라인은 작성하지 말고 이 클립에서 한국어로 실제 들리는 발언 문장만 순서대로 받아써라. 화자의 단어 선택과 문장 순서를 가능한 한 유지한다. 발언이 생략되거나 문장을 새로 만들지 않는다. 특히 클립 맨 끝까지 확인한다. startSeconds/endSeconds는 반드시 **클립 안에서 0초부터 시작하는 상대시간**이며 원본 전체 영상 시각이 아니다. 1초에 많은 글자가 몰리는 것은 허용하지 않는다. 정확히 들리지 않는 문장은 제외한다. 응답 형식: JSON 객체 {"lines":[{"startSeconds":0,"endSeconds":3,"text":"실제로 들린 말"}]}. 다른 필드는 작성하지 않는다.`}];
}

export type ClipResult = {segment:SpeechSegment;parsed?:unknown;failure?:string};
export function collectSpeechClipResults(outcomes:ClipResult[],segments:SpeechSegment[]):{
  lines:TranscriptLine[];coveredSegments:number[];failedSegments:number[];missingWindows:SpeechReviewWindow[];rejected:number;
}{
  const clips=outcomes.flatMap(o=>o.parsed? [{segmentIndex:o.segment.index,lines:(o.parsed as {lines?:unknown}).lines}]:[]);
  const parsed=parseSegmentedSpeech({segmentTranscripts:clips},segments);
  const coveredSegments=segments.filter(s=>parsed.includedSegments.includes(s.index)&&parsed.lines.some(l=>l.startSeconds>=s.from&&l.startSeconds<s.to)).map(s=>s.index);
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
