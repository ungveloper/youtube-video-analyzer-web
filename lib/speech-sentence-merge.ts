/** Conservative speech fragment consolidation. Never invent missing words or times. */
import type {TranscriptLine} from './types';

const normal=(s:string)=>s.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
const complete=(s:string)=>/[.!?。！？]["'”’)]?\s*$/.test(s.trim()) || /(?:습니다|입니다|됩니다|했어요|했죠|했는데요|있습니다|없습니다|이에요|예요|거예요|않아요|세요|까요|지요|네요|고요|이고요|는데요|랍니다|겁니다|겠죠|있어요|없어요|합니다|했답니다)[.!?。！？\s]*$/.test(s.trim());
const hanging=(s:string)=>/(?:\s|^)(?:그런데|그리고|또는|하지만)$/.test(s.trim()) || /(?:면서|가지고|때가|점점|부터|그런|이런|그|이|의|에|을|를|은|는|가|과|와|에게|에서|까지|때문에|때에는|하게|하도록|는데|다가|면서|되고|그래서|그러면|보면|경우는|경우가|것을|것과|것이|수가|있고|있으며|있는데|만큼|혹은|또한|때에|손쉽게|여러분의)$/.test(s.trim());
const startConnector=(s:string)=>/^(?:안쪽에|좁아지는|어디서|폐색이|많이|누르|그렇게|이어서|다음에|그래서|결국|다리에|피로에|몸에|걸을|만져보면|정확히|그것은|것과|것이|보내는|지금|이를|이런)\b/.test(s.trim());

/** Join adjacent, plausible fragments only. The earliest observed timestamp wins. */
export function mergeSpeechSentences(lines:TranscriptLine[],duration:number):TranscriptLine[]{
 const ordered=[...lines].filter(x=>Number.isFinite(x.startSeconds)&&Number.isFinite(x.endSeconds)&&x.endSeconds>x.startSeconds&&x.startSeconds>=0&&x.endSeconds<=duration&&x.text.trim()).sort((a,b)=>a.startSeconds-b.startSeconds);
 const result:TranscriptLine[]=[];
 for(const raw of ordered){
   const line={...raw,text:raw.text.trim()};
   const prev=result.at(-1);
   if(!prev){result.push(line);continue;}
   const a=normal(prev.text),b=normal(line.text);
   if(a===b || (b.length>=10&&a.includes(b)))continue;
   if(a.length>=10&&b.startsWith(a)){
     prev.text=line.text;prev.endSeconds=Math.max(prev.endSeconds,line.endSeconds);continue;
   }
   if(b.length>=10&&a.startsWith(b))continue;
   // A gap >=5s is not safe to merge. Never merge a completed sentence.
   const gap=line.startSeconds-prev.endSeconds;
   const delta=line.startSeconds-prev.startSeconds;
   const continuation= !complete(prev.text) && (hanging(prev.text)||startConnector(line.text)||prev.text.length<28);
   if(gap<=4.5&&gap>=-2&&delta<=15&&continuation&&prev.text.length+line.text.length<230){
     const suffixOverlap=(()=>{for(let k=Math.min(prev.text.length,line.text.length,45);k>=7;k--)if(normal(prev.text.slice(-k))===normal(line.text.slice(0,k)))return k;return 0;})();
     prev.text=(prev.text+(suffixOverlap?line.text.slice(suffixOverlap):' '+line.text)).replace(/\s+/g,' ').trim();
     prev.endSeconds=Math.max(prev.endSeconds,line.endSeconds);
   } else result.push(line);
 }
 return result;
}

/** Large intervals between transcript utterances need targeted listening. */
export function largestSpeechGap(lines:TranscriptLine[],duration:number,minGap=19):{from:number;to:number}|null{
 const sorted=[...lines].filter(x=>x.endSeconds>x.startSeconds).sort((a,b)=>a.startSeconds-b.startSeconds);
 if(!sorted.length)return null;
 let cursor=0;let best:{from:number;to:number}|null=null;
 for(const line of sorted){if(line.startSeconds-cursor>=minGap&&(!best||line.startSeconds-cursor>best.to-best.from))best={from:cursor,to:line.startSeconds};cursor=Math.max(cursor,line.endSeconds);}
 if(duration-cursor>=minGap&&(!best||duration-cursor>best.to-best.from))best={from:cursor,to:duration};
 return best;
}
