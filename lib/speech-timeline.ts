/** URL speech is a model estimate, not authenticated captions. Strictly isolate
 * supplementary speech by the actually requested time window so tail speech
 * cannot be erroneously inserted at 00:02 (v22 regression). */
import type {Evidence, GroundedItem, TranscriptLine} from './types';

export type SpeechReviewWindow = {from:number; to:number};
const normalized=(text:string)=>text.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
const validLine=(l:TranscriptLine,duration:number)=>Number.isFinite(l.startSeconds)&&Number.isFinite(l.endSeconds)&&l.startSeconds>=0&&l.endSeconds>=l.startSeconds&&l.endSeconds<=duration&&l.text.trim().length>=8;

export function speechReviewWindows(lines:TranscriptLine[], duration:number):SpeechReviewWindow[]{
  if(duration<=0)return [];
  const ordered=[...lines].filter(l=>validLine(l,duration)).sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!ordered.length)return [];
  const threshold=Math.max(17,Math.min(28,duration*0.1));
  let cursor=0;
  const gaps:SpeechReviewWindow[]=[];
  for(const line of ordered){
    if(line.startSeconds-cursor>=threshold)gaps.push({from:cursor,to:line.startSeconds});
    cursor=Math.max(cursor,line.endSeconds);
  }
  if(duration-cursor>=threshold)gaps.push({from:cursor,to:duration});
  if(!gaps.length && duration>=120 && ordered.length<Math.floor(duration/18))
    return [{from:0,to:duration}];
  return gaps.slice(0,6);
}
/** Deduplicate the FIRST Gemini transcript without rewriting the words or
 * inventing timestamps. This also protects against two initial rows at 00:00/00:01
 * repeating the same sentence before a supplement is even considered. */
export function dedupeInitialSpeech(lines:TranscriptLine[], duration:number):TranscriptLine[]{
  const seen=new Set<string>();
  return [...lines].filter(line=>validLine(line,duration)).sort((a,b)=>a.startSeconds-b.startSeconds).filter(line=>{
    const key=normalized(line.text);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

/** Send ONE narrow window, prioritizing a missing tail over middle gaps.
 * An unrestricted full-video supplement can replay beginning/middle speech
 * under nonsensical near-zero timestamps. */
export function chooseSpeechRecoveryWindow(windows:SpeechReviewWindow[],duration:number):SpeechReviewWindow[]{
  const safe=windows.filter(w=>Number.isFinite(w.from)&&Number.isFinite(w.to)&&w.from>=0&&w.to>w.from&&w.to<=duration);
  if(!safe.length)return [];
  const late=safe.filter(w=>w.to>=duration-1&&w.from>=duration*0.25).sort((a,b)=>b.to-b.from-(a.to-a.from));
  if(late.length)return [late[0]];
  const others=[...safe].sort((a,b)=>(b.to-b.from)-(a.to-a.from));
  const widest=others[0];
  // An entirely untranscribed video needs particular attention to the final
  // section, not another unlimited whole-video free-form request.
  if(widest.from===0&&widest.to===duration&&duration>=90)return [{from:Math.floor(duration*0.5),to:duration}];
  return [widest];
}

export function speechFirstTimeline(lines:TranscriptLine[], originalEvidence:Evidence[], duration:number):{timeline:GroundedItem[];evidence:Evidence[];lastEnd:number|null}{
  const valid=[...lines].filter(l=>validLine(l,duration)).sort((a,b)=>a.startSeconds-b.startSeconds);
  const uniq=new Set<string>();
  const evidence=[...originalEvidence];const timeline:GroundedItem[]=[];
  for(const [i,line] of valid.entries()){
    const utterance=line.text.trim();
    const signature=normalized(utterance);
    // Identical speech returned at two different times is not two verified
    // utterances. Never duplicate it merely because the timecode differs.
    if(uniq.has(signature))continue;
    uniq.add(signature);
    const id=`speech-evidence-${i}`;
    evidence.push({id,startSeconds:line.startSeconds,endSeconds:line.endSeconds,kind:'audio',note:utterance});
    timeline.push({id:`speech-line-${i}`,title:'',text:utterance,evidenceIds:[id]});
  }
  return {timeline,evidence,lastEnd:valid.length?Math.max(...valid.map(x=>x.endSeconds)):null};
}

export type SpeechMergeResult={lines:TranscriptLine[];added:number;rejected:number;rejectedOutOfWindow:number};
/** Supplemental Gemini timecodes are unverified. Reject content from OUTSIDE
 * the explicit requested range, implausibly compressed speech, overlapping
 * original lines and duplicates irrespective of timestamp. */
export function mergeSupplementalSpeech(existing:TranscriptLine[],value:unknown,duration:number,requested:SpeechReviewWindow[]):SpeechMergeResult{
  const object=value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const input=Array.isArray(object.lines)?object.lines:[];
  const windows=requested.filter(w=>Number.isFinite(w.from)&&Number.isFinite(w.to)&&w.from>=0&&w.to>w.from&&w.to<=duration);
  const known=new Set(existing.map(x=>normalized(x.text)));
  const additions:TranscriptLine[]=[];
  let rejected=0,rejectedOutOfWindow=0;
  for(const [i,v] of input.slice(0,100).entries()){
    if(!v||typeof v!=='object'){rejected++;continue;}
    const row=v as Record<string,unknown>;
    const start=row.startSeconds,end=row.endSeconds,raw=row.text;
    if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration||typeof raw!=='string'||raw.trim().length<8){rejected++;continue;}
    // Critically, this check was missing in v22: a final-minute quote could
    // arrive stamped at 00:02 and silently corrupt the complete chronology.
    if(!windows.some(w=>start>=w.from-0.25&&end<=w.to+1)){rejected++;rejectedOutOfWindow++;continue;}
    const utterance=raw.trim().slice(0,1300),signature=normalized(utterance);
    if(known.has(signature)){rejected++;continue;}
    // An entire paragraph cannot reliably fit in a 1-2 second utterance.
    // Conservative threshold; only used to reject obviously bad estimates.
    const visible=utterance.replace(/\s/g,'').length;
    if(visible>Math.max(36,(end-start)*15+12)){rejected++;continue;}
    if([...existing,...additions].some(l=>Math.abs(l.startSeconds-start)<1 || (start<l.endSeconds-1&&end>l.startSeconds+1))){rejected++;continue;}
    known.add(signature);
    additions.push({id:`speech-supplement-${i}`,startSeconds:start,endSeconds:end,text:utterance,translated:false});
  }
  return {lines:[...existing,...additions].sort((a,b)=>a.startSeconds-b.startSeconds),added:additions.length,rejected,rejectedOutOfWindow};
}
