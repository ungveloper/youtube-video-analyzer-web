/** Speech-first URL timeline. Gemini-derived times/wording remain UNVERIFIED.
 * Never turn editorial timeline summaries into a supposed verbatim transcript. */
import type {Evidence, GroundedItem, TranscriptLine} from './types';

export type SpeechReviewWindow = {from:number; to:number};
export function speechReviewWindows(lines:TranscriptLine[], duration:number):SpeechReviewWindow[]{
  if(duration<=0)return [];
  const ordered=[...lines].filter(l=>Number.isFinite(l.startSeconds)&&Number.isFinite(l.endSeconds)&&l.startSeconds>=0&&l.endSeconds>=l.startSeconds&&l.endSeconds<=duration&&l.text.trim().length>=8)
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!ordered.length)return [];
  const threshold=Math.max(17,Math.min(28,duration*0.1));
  let cursor=0;
  const gaps:SpeechReviewWindow[]=[];
  for(const line of ordered){
    if(line.startSeconds-cursor>=threshold)gaps.push({from:cursor,to:line.startSeconds});
    cursor=Math.max(cursor,line.endSeconds);
  }
  if(duration-cursor>=threshold)gaps.push({from:cursor,to:duration});
  // A handful of long model-generated lines may span a whole video while
  // omitting most sentences. Treat this as a density REVIEW, not proof of silence.
  // A second request is optional and never synthesizes timecodes itself.
  if(!gaps.length && duration>=120 && ordered.length<Math.floor(duration/18))
    return [{from:0,to:duration}];
  return gaps.slice(0,6);
}
export function speechFirstTimeline(lines:TranscriptLine[], originalEvidence:Evidence[], duration:number):{timeline:GroundedItem[];evidence:Evidence[]; lastEnd:number|null}{
  const valid=[...lines].filter(l=>Number.isFinite(l.startSeconds)&&Number.isFinite(l.endSeconds)&&l.startSeconds>=0&&l.endSeconds>=l.startSeconds&&l.endSeconds<=duration&&l.text.trim().length>=8)
    .sort((a,b)=>a.startSeconds-b.startSeconds);
  const uniq=new Set<string>();
  const evidence=[...originalEvidence];const timeline:GroundedItem[]=[];
  for(const [i,line] of valid.entries()){
    const utterance=line.text.trim();
    const signature=`${line.startSeconds}:${utterance.replace(/\s+/g,'')}`;
    if(uniq.has(signature))continue;
    uniq.add(signature);
    const id=`speech-evidence-${i}`;
    // This is a MODEL interpretation of the video audio, not a trusted caption.
    evidence.push({id,startSeconds:line.startSeconds,endSeconds:line.endSeconds,kind:'audio',note:utterance});
    timeline.push({id:`speech-line-${i}`,title:'',text:utterance,evidenceIds:[id]});
  }
  return {timeline,evidence,lastEnd:valid.length?Math.max(...valid.map(x=>x.endSeconds)):null};
}
/** Strictly validate a supplemental response: it cannot add timestamps outside the video
 * or relabel a generated utterance as a user-provided caption. */
export function mergeSupplementalSpeech(existing:TranscriptLine[], value:unknown,duration:number):{lines:TranscriptLine[]; added:number}{
  const object=value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const input=Array.isArray(object.lines)?object.lines:[];
  const seen=new Set(existing.map(x=>`${Math.floor(x.startSeconds)}:${x.text.replace(/\s+/g,'').trim().toLowerCase()}`));
  const additions:TranscriptLine[]=[];
  for(const [i,v] of input.slice(0,80).entries()){
    if(!v||typeof v!=='object')continue;
    const row=v as Record<string,unknown>;
    const start=row.startSeconds,end=row.endSeconds,raw=row.text;
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>duration||typeof raw!=='string'||raw.trim().length<8)continue;
    const utterance=raw.trim().slice(0,1300);
    const key=`${Math.floor(start)}:${utterance.replace(/\s+/g,'').toLowerCase()}`;
    if(seen.has(key))continue;
    seen.add(key);
    additions.push({id:`speech-supplement-${i}`,startSeconds:start,endSeconds:end,text:utterance,translated:false});
  }
  return {lines:[...existing,...additions].sort((a,b)=>a.startSeconds-b.startSeconds),added:additions.length};
}
