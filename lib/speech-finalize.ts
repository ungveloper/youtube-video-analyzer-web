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
  if(!short||Math.abs(a.startSeconds-b.startSeconds)>27)return false;
  if(x===y)return true;
  if(short<8)return false;
  const same=(x.includes(y)||y.includes(x));
  // A short repeated clause can be part of a longer, complete sentence.
  if(same)return short>=11 || Math.abs(a.startSeconds-b.startSeconds)<=8;
  const shared=sharedSpan(x,y).length;
  // A later fragment may repeat the ending of a fuller sentence with a
  // small spelling difference (e.g. extra modifier) in the first few words.
  if(short>=14 && shared>=11 && shared/short>=.60 && Math.abs(a.startSeconds-b.startSeconds)<=7)return true;
  return short>=16 && short/long>=.47 && shared/short>=.78 && shared>=13;
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
  const parent=remaining.map((_,i)=>i);
  const find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<remaining.length;i++)for(let j=i+1;j<remaining.length;j++){
    if(remaining[j].startSeconds-remaining[i].startSeconds>27)break;
    if(duplicates(remaining[i],remaining[j])){
      const a=find(i),b=find(j);if(a!==b)parent[b]=a;
    }
  }
  const grouped=new Map<number,TranscriptLine[]>();
  for(let i=0;i<remaining.length;i++){
    const p=find(i);const g=grouped.get(p)||[];g.push(remaining[i]);grouped.set(p,g);
  }
  const kept:TranscriptLine[]=[];
  for(const group of grouped.values()){
    group.sort((a,b)=>score(b)-score(a)||a.startSeconds-b.startSeconds);
    kept.push(group[0]);
  }
  kept.sort((a,b)=>a.startSeconds-b.startSeconds||a.endSeconds-b.endSeconds);
  // Distinct content at conflicting model times is deliberately NOT deleted.
  // Expose the uncertainty instead of pretending we verified these timecodes.
  let unverifiedTimeCollisions=0;
  for(let i=1;i<kept.length;i++){
    const prev=kept[i-1],curr=kept[i];
    if(curr.startSeconds<prev.endSeconds-1 && !duplicates(prev,curr))unverifiedTimeCollisions++;
  }
  return {lines:kept,duplicatesRemoved:remaining.length-kept.length,collagesQuarantined:quarantined.size,unverifiedTimeCollisions};
}
