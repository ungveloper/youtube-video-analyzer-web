/** Final pass for independent, estimated-timing Korean video transcripts.
 * No external captions, specific video phrases or invented speech.
 * This only reconciles already returned utterances; it is NOT forced alignment.
 */
import type {TranscriptLine} from './types';

const normalize=(s:string)=>s.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
const valid=(l:TranscriptLine,d:number)=>Number.isFinite(l.startSeconds)&&Number.isFinite(l.endSeconds)&&l.startSeconds>=0&&l.endSeconds>l.startSeconds&&l.endSeconds<=d&&l.text.trim().length>=4;

/** Longest CONTIGUOUS common Korean-character run (not topic similarity). */
function sharedSpan(a:string,b:string):{at:number;length:number}{
  if(!a||!b)return {at:0,length:0};
  // Two 480-character caps prevent quadratic blowups from provider paragraphs.
  a=a.slice(0,480);b=b.slice(0,480);
  let prior=new Uint16Array(b.length+1),best={at:0,length:0};
  for(let i=1;i<=a.length;i++){
    const next=new Uint16Array(b.length+1);
    for(let j=1;j<=b.length;j++){
      if(a[i-1]===b[j-1]){
        next[j]=prior[j-1]+1;
        if(next[j]>best.length)best={at:i-next[j],length:next[j]};
      }
    }
    prior=next;
  }
  return best;
}

function duplicates(a:TranscriptLine,b:TranscriptLine):boolean{
  const x=normalize(a.text),y=normalize(b.text),short=Math.min(x.length,y.length),long=Math.max(x.length,y.length);
  const distance=Math.abs(a.startSeconds-b.startSeconds);
  if(!short||distance>27)return false;
  // Two truly repeated spoken statements can occur in the same video. A
  // distant time estimate is deduplicated only against an independent audio
  // re-listen and with near-exact text, not loose topical resemblance.
  if(distance>12){
    if(![a,b].some(l=>l.id.startsWith('coverage-')))return false;
    return x===y || ((x.includes(y)||y.includes(x)) && short>=17 && (short/long>=.82 || (short>=22 && /(?:의|에|는|은|을|를|는데|가지고|다가|으니|니까|어서|면서)$/u.test([a,b].find(v=>normalize(v.text).length===short)?.text.trim()||''))));
  }
  if(x===y)return true;
  if(short<8)return false;
  if(x.includes(y)||y.includes(x))return short>=11 || distance<=5;
  const shared=sharedSpan(x,y).length;
  // Close-in wording variants are often the same Gemini speech repeated by
  // a neighbor clip. Do not equate two distinct content-rich sentences.
  return short>=14 && shared>=11 && shared/short>=.60 && distance<=6;
}

/** Join ONLY a literal trailing phrase repeated at the start of the next
 * utterance. Unlike generic sentence merging, no unseen word is introduced.
 * Source text must be auditable: A + the non-overlapping suffix of B.
 */
function joinQuotedOverlap(first:TranscriptLine,second:TranscriptLine):TranscriptLine|null{
  if(second.startSeconds<first.startSeconds||second.startSeconds-first.startSeconds>14||second.startSeconds>first.endSeconds+6)return null;
  if(/[.!?。！？]\s*$/.test(first.text))return null;
  const a=first.text.trim(),b=second.text.trim();
  for(let n=Math.min(a.length,b.length,100);n>=12;n--){
    if(a.slice(-n)!==b.slice(0,n))continue;
    const rest=b.slice(n).trimStart();
    if(rest.length<5)continue;
    const combined=(a+' '+rest).replace(/\s+/g,' ').trim();
    if(combined.length>900)continue;
    return {...first,text:combined,endSeconds:Math.max(first.endSeconds,second.endSeconds)};
  }
  return null;
}

/** A collage contains distinct long quotations ALSO present in other rows,
 * but those two other rows refer to audio at widely separated times.
 * Quarantine rather than spreading it across the chronology or inventing a fix.
 */
function suspiciousCollage(line:TranscriptLine,all:TranscriptLine[]):boolean{
  const quote=normalize(line.text);
  if(quote.length<45)return false;
  const hits:{from:number;to:number;time:number}[]=[];
  for(const other of all){
    if(other===line || Math.abs(other.startSeconds-line.startSeconds)<.8)continue;
    const matched=sharedSpan(quote,normalize(other.text));
    if(matched.length<14)continue;
    hits.push({from:matched.at,to:matched.at+matched.length,time:other.startSeconds});
  }
  for(let i=0;i<hits.length;i++)for(let j=i+1;j<hits.length;j++){
    const a=hits[i],b=hits[j];
    const separation=Math.abs(a.time-b.time);
    const distinct=Math.min(a.to,b.to)-Math.max(a.from,b.from)<=3;
    if(distinct&&separation>=16&&Math.max(Math.abs(a.time-line.startSeconds),Math.abs(b.time-line.startSeconds))>=12)return true;
  }
  return false;
}

const score=(l:TranscriptLine)=>{
  const text=l.text.trim();
  const length=Math.min(200,normalize(text).length);
  const reviewed=l.id.startsWith('coverage-')?12:0;
  const complete=/[.!?。！？]\s*$/.test(text)?3:0;
  const hanging=/(?:의|는|은|가|를|을|인데|그래서|그리고|여러분의|가지고|다가|으니)\s*$/.test(text)?-8:0;
  return length*.55+reviewed+complete+hanging;
};

export type FinalSpeechReport={lines:TranscriptLine[];duplicatesRemoved:number;collagesQuarantined:number;unverifiedTimeCollisions:number};
/** Dedupe across ORIGINAL+SALVAGED+RELISTEN results. Review has modest
 * preference, while longer complete transcripts normally beat fragments.
 * Never stitch unrelated text from different time ranges to form a new quote.
 */
export function finalizeSpeechTimeline(input:TranscriptLine[],duration:number):FinalSpeechReport{
  const validRows=input.filter(l=>valid(l,duration)).map(l=>({...l,text:l.text.trim()})).sort((a,b)=>a.startSeconds-b.startSeconds);
  const quarantined=new Set(validRows.filter(l=>suspiciousCollage(l,validRows)));
  const remaining=validRows.filter(l=>!quarantined.has(l));
  // Reconstruct one sentence when independently returned rows share a literal
  // suffix/prefix (e.g. “결국 ... 폐색되는” repeated before its ending). Do this
  // BEFORE duplicate filtering so the shorter clause cannot displace the full
  // speech; never assemble lines solely due to neighboring timestamps.
  const stitched:TranscriptLine[]=[];
  for(const row of remaining){
    const prev=stitched.at(-1);
    const joined=prev?joinQuotedOverlap(prev,row):null;
    if(joined){stitched[stitched.length-1]=joined;}
    else stitched.push(row);
  }
  // v4.2 transitive union-find collapsed A~B and B~C even when A and C
  // describe DIFFERENT speech. Each rejected row must directly match ONE
  // retained row. A fuzzy bridge can no longer erase a 30s time span.
  const ranked=stitched.map((l,i)=>({l,i})).sort((a,b)=>score(b.l)-score(a.l)||a.l.startSeconds-b.l.startSeconds);
  const kept:TranscriptLine[]=[];
  for(const {l} of ranked){
    if(kept.some(existing=>duplicates(existing,l)))continue;
    kept.push(l);
  }
  kept.sort((a,b)=>a.startSeconds-b.startSeconds||a.endSeconds-b.endSeconds);
  let unverifiedTimeCollisions=0;
  for(let i=1;i<kept.length;i++){
    const prev=kept[i-1],curr=kept[i];
    if(curr.startSeconds<prev.endSeconds-1 && !duplicates(prev,curr))unverifiedTimeCollisions++;
  }
  return {lines:kept,duplicatesRemoved:remaining.length-kept.length,collagesQuarantined:quarantined.size,unverifiedTimeCollisions};
}
