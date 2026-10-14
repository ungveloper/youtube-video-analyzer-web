/** Deterministic, bounded source clips for short static YouTube video analysis.
 * A Gemini estimate within a segment still is NOT an authenticated caption. */
import type { TranscriptLine } from './types';

export type SpeechSegment = { index:number; from:number; to:number; coreFrom?:number; coreTo?:number };

/** Three non-overlapping clips, preserving the whole 2–5 minute duration.
 * Do not segment long or agentic videos: static clipping is the only supported mode. */
export function shortSpeechSegments(duration:number,processing:'static'|'agentic'):SpeechSegment[]{
  if(processing!=='static'||!Number.isFinite(duration)||duration<120||duration>300)return [];
  const first=Math.round(duration/3),second=Math.round(2*duration/3);
  return [{index:0,from:0,to:first},{index:1,from:first,to:second},{index:2,from:second,to:duration}];
}

/** For URL speech transcription only: short, overlapped static windows.
 * coreFrom/coreTo describe unique OWNERSHIP of utterance starts. The extra
 * 4 seconds on each side are listening context, not independent speech time.
 * Clip timestamps are still AI estimates, never certified subtitle timings.
 */
export function precisionSpeechSegments(duration:number,processing:'static'|'agentic'):SpeechSegment[]{
  if(processing!=='static'||!Number.isInteger(duration)||duration<120||duration>300)return [];
  const count=Math.min(8,Math.ceil(duration/34));
  const bounds=Array.from({length:count+1},(_,i)=>Math.round(duration*i/count));
  return Array.from({length:count},(_,index)=>{
    const coreFrom=bounds[index],coreTo=bounds[index+1];
    return {index,from:Math.max(0,coreFrom-4),to:Math.min(duration,coreTo+4),coreFrom,coreTo};
  });
}

/** Interactions API requires a string seconds suffix for media offsets. */
export function clipProcessing(segment:SpeechSegment){
  return {type:'static' as const,start_offset:`${segment.from}s`,end_offset:`${segment.to}s`};
}

/** REST video content builder for static clips. Google rejects 'name' (serialized
 * as display_name) when processing is STATIC. Keep the outgoing keys minimal. */
export function clipVideoInputs(uri:string,segments:SpeechSegment[]){
  return segments.map(segment=>({type:'video' as const,uri,processing:clipProcessing(segment)}));
}

const signature=(text:string)=>text.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
export type SegmentedSpeechResult={lines:TranscriptLine[];includedSegments:number[];rejected:number;missingSegments:number[]};
/** Gemini's segment-relative timestamps are translated by CODE, never by a
 * provider estimate about the position of an entire original video. Reject
 * segment-local times outside their range, impossible one-second paragraphs,
 * overlaps, and duplicate statements. A clipped segment must not be relabeled
 * as if it were a verified speech-to-text file. */
export function parseSegmentedSpeech(response:unknown,segments:SpeechSegment[]):SegmentedSpeechResult {
  const obj=response&&typeof response==='object'?response as Record<string,unknown>:{};
  const chunks=Array.isArray(obj.segmentTranscripts)?obj.segmentTranscripts:[];
  const includedSegments:number[]=[],seen=new Set<string>();
  const lines:TranscriptLine[]=[];
  let rejected=0;
  for(const seg of segments){
    const matching=chunks.filter(v=>v&&typeof v==='object'&&(v as Record<string,unknown>).segmentIndex===seg.index);
    if(matching.length!==1){rejected+=matching.length;continue;}
    const row=matching[0] as Record<string,unknown>;
    if(!Array.isArray(row.lines)||row.lines.length>120){rejected++;continue;}
    includedSegments.push(seg.index);
    for(const [i,item] of row.lines.entries()){
      if(!item||typeof item!=='object'){rejected++;continue;}
      const l=item as Record<string,unknown>,start=l.startSeconds,end=l.endSeconds,text=l.text;
      if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>seg.to-seg.from+0.001||typeof text!=='string'||text.trim().length<4){rejected++;continue;}
      const phrase=text.trim().slice(0,1100),normalized=signature(phrase);
      if(!normalized||seen.has(normalized)){rejected++;continue;}
      const glyphs=phrase.replace(/\s/g,'').length;
      if(glyphs>Math.max(40,(end-start)*15+12)){rejected++;continue;}
      const globalStart=seg.from+start,globalEnd=seg.from+end;
      // Only a single precise segment owns each utterance start. Neighbor
      // contexts help hear cut-off speech, but must not duplicate its time.
      const ownerFrom=seg.coreFrom??seg.from,ownerTo=seg.coreTo??seg.to;
      if(globalStart<ownerFrom-0.5||globalStart>=ownerTo+0.5){rejected++;continue;}
      if(lines.some(prev=>Math.abs(prev.startSeconds-globalStart)<0.8||globalStart<prev.endSeconds-0.7&&globalEnd>prev.startSeconds+0.7)){rejected++;continue;}
      seen.add(normalized);
      lines.push({id:`segment-${seg.index}-${i}`,startSeconds:globalStart,endSeconds:globalEnd,text:phrase,translated:false});
    }
  }
  lines.sort((a,b)=>a.startSeconds-b.startSeconds);
  return {lines,includedSegments,rejected,missingSegments:segments.filter(x=>!includedSegments.includes(x.index)).map(x=>x.index)};
}
