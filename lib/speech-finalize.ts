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

/** Ordered shared characters, unlike longest contiguous string matching.
 * Restrict fuzzy grouping to HIGH substring coverage and nearby starts:
 * two distinct disease explanations can share words without being repeats.
 */
function sequenceCoverage(shorter:string,longer:string):number{
  if(!shorter||!longer)return 0;
  if(shorter.length>240||longer.length>500)return 0;
  let prev=new Uint16Array(longer.length+1);
  for(const ch of shorter){
    const next=new Uint16Array(longer.length+1);
    for(let j=1;j<=longer.length;j++)
      next[j]=ch===longer[j-1]?prev[j-1]+1:Math.max(next[j-1],prev[j]);
    prev=next;
  }
  return prev[longer.length]/shorter.length;
}

function duplicates(a:TranscriptLine,b:TranscriptLine):boolean{
  const x=normalize(a.text),y=normalize(b.text);
  const short=Math.min(x.length,y.length),long=Math.max(x.length,y.length);
  const distance=Math.abs(a.startSeconds-b.startSeconds);
  if(!short||distance>27)return false;
  // Genuine spoken repetition must survive if separated in the video.
  // For large estimated clock differences only identical independent re-listens
  // can be trusted enough to deduplicate.
  if(distance>14)return [a,b].some(l=>l.id.startsWith('coverage-')) && (x===y || ((x.includes(y)||y.includes(x)) && short>=20));
  if(x===y)return true;
  const containment=x.includes(y)||y.includes(x);
  if(containment)return short>=8 || distance<=5;
  if(short<9)return false;
  // Adjacent clips often disagree on 1-2 Korean syllables (이렇듯/이렇든,
  // 손쉽게/쉽게), but the remaining ordered quotation is identical.
  // Only dedupe a high-coverage fragment within one local speech interval.
  const orderedShort=x.length<=y.length?x:y,orderedLong=x.length>y.length?x:y;
  if(distance<=12 && short>=11){
    const shared=sharedSpan(x,y).length;
    // A shared ending is not proof that two DIFFERENT subjects describe the
    // same utterance (e.g. disease A vs disease B). Require an ordered lead-in
    // anchor, except an almost exact one-syllable recognition variation.
    const leadingAnchor=orderedLong.includes(orderedShort.slice(0,2));
    if(!leadingAnchor && shared/short<.91)return false;
    if(short/long>=.75 && /(?:아니|않|없|못)/u.test(x)!==/(?:아니|않|없|못)/u.test(y))return false;
    if(shared>=10 && shared/short>=(short<=12?.90:.70))return true;
    if(leadingAnchor && sequenceCoverage(orderedShort,orderedLong)>=.90 && (shared>=8 || short>=25))return true;
  }
  return false;
}

/** The same sentence can be restamped up to ~40 seconds early by an
 * independently estimated video clip. Only an unfinished QUOTE FRAGMENT
 * may be suppressed at that distance, against a much fuller later quote.
 * Full sentences repeated far apart are genuine evidence, not duplicates.
 */
function distantFragmentEcho(a:TranscriptLine,b:TranscriptLine):boolean{
  const distance=Math.abs(a.startSeconds-b.startSeconds);
  if(distance<=14||distance>55)return false;
  const shorter=normalize(a.text).length<=normalize(b.text).length?a:b;
  const fuller=shorter===a?b:a;
  const x=normalize(shorter.text),y=normalize(fuller.text);
  if(x.length<18||y.length<x.length+12||x.length/y.length>.82)return false;
  // Never move a verified complete, clearly standalone phrase to a new time.
  if(/[.!?。！？]\s*$/.test(shorter.text))return false;
  const passage=sharedSpan(x,y).length;
  const contentAgreement=passage>=15&&passage/x.length>=.57&&sequenceCoverage(x,y)>=.82;
  const leftSource=/^(?:segment|salvaged)-(\d+)-/.exec(shorter.id)?.[1];
  const rightSource=/^(?:segment|salvaged)-(\d+)-/.exec(fuller.id)?.[1];
  const sameSource=leftSource!==undefined&&leftSource===rightSource;
  // Independent neighboring listens commonly repeat the same words. Two
  // separate complete statements or unrelated clauses must both survive.
  return contentAgreement && !sameSource;
}

/** Remove a recognizer's short trailing echo without deleting real speech.
 * This requires a near-identical sentence ending (not general similarity).
 */
function localTailEcho(a:TranscriptLine,b:TranscriptLine):boolean{
  if(Math.abs(a.startSeconds-b.startSeconds)>13)return false;
  const shorter=normalize(a.text).length<=normalize(b.text).length?a:b;
  const fuller=shorter===a?b:a;
  const x=normalize(shorter.text),y=normalize(fuller.text);
  if(x.length<7||x.length>34||y.length<=x.length+6)return false;
  // A short phrase can be an independently spoken sentence. Suppress only
  // almost all of its words appearing in a longer nearby source quotation.
  const longest=sharedSpan(x,y).length;
  if(longest>=9 && longest/x.length>=.76 && sequenceCoverage(x,y)>=.88)return true;
  // A tiny, one-syllable mistranscribed repeat of the PREVIOUS sentence's
  // ending ("...이 되겠습니다") should not become another timestamp.
  // Require the same final 7+ normalized characters, an immediately nearby
  // longer source phrase, and near-total ordered character agreement.
  if(x.length>=7&&x.length<=14&&y.length>=x.length+12&&
    Math.abs(a.startSeconds-b.startSeconds)<=8){
    const suffix=x.slice(-Math.min(8,x.length-1));
    if(suffix.length>=6&&y.endsWith(suffix)&&sequenceCoverage(x,y)>=.75)return true;
  }
  return false;
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
  // Do not let a short relisten fragment displace a fuller original quote.
  const reviewed=l.id.startsWith('coverage-')?2:0;
  const complete=/[.!?。！？]\s*$/.test(text)?3:0;
  const hanging=/(?:의|는|은|가|를|을|인데|그래서|그리고|여러분의|가지고|다가|으니|,|、)\s*$/.test(text)?-12:0;
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
    if(kept.some(existing=>duplicates(existing,l)||distantFragmentEcho(existing,l)||localTailEcho(existing,l)))continue;
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
