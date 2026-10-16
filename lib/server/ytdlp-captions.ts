/** Local YouTube timed-caption fallback, not audio recognition.
 * Fetch the video's *existing* Korean captions (manual or YouTube ASR) using
 * yt-dlp when the existing public caption fetcher has failed. No Gemini calls.
 * No user cookies, video download, shell, or specific-video hardcoded text.
 */
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AnalysisRecord,TranscriptLine} from '../types';

export type TimedCaptionResult={srt:string;count:number;end:number};
const videoIdPattern=/^[a-zA-Z0-9_-]{11}$/;
const MAX_BYTES=2_000_000;
const clock=(n:number)=>{
  const ms=Math.max(0,Math.round(n*1000));
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
};
function seconds(value:string):number{
  const nums=value.trim().replace(',','.').split(':').map(Number);
  if(nums.some(x=>!Number.isFinite(x))||(nums.length!==2&&nums.length!==3))return NaN;
  return nums.reduce((acc,n)=>acc*60+n,0);
}
function plain(raw:string):string{
  return raw
    .replace(/<\d\d:\d\d(?::\d\d)?\.\d{3}>/g,'')
    .replace(/<[^>]*>/g,'')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[\da-f]+);/gi,e=>{
      const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
      const n=named[e.toLowerCase()];if(n!==undefined)return n;
      const rawNumber=e.slice(2,-1),point=rawNumber[0]?.toLowerCase()==='x'?parseInt(rawNumber.slice(1),16):parseInt(rawNumber,10);
      return Number.isInteger(point)&&point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
    })
    .replace(/\[[^\]]*(?:음악|music|박수|applause)[^\]]*\]/gi,'')
    .replace(/\s+/g,' ').trim();
}

type CaptionCue={start:number;end:number;text:string};

/** YouTube automatic VTT often repeats the PREVIOUS subtitle line at the
 * beginning of the next cue: A+B, then B+C, then C+D. Matching a complete
 * cue (or startsWith) does not detect this rolling suffix/prefix repetition.
 * Require an exact multi-word overlap, never topical/fuzzy similarities.
 */
function rollingOverlap(previous:string,current:string):number{
  if(previous===current)return current.length;
  if(previous.includes(current) && current.length>=10)return current.length;
  const limit=Math.min(previous.length,current.length,250);
  for(let n=limit;n>=10;n--){
    const overlap=current.slice(0,n);
    if(!/\s/u.test(overlap))continue; // a single common word is not evidence
    if(previous.endsWith(overlap))return n;
  }
  return 0;
}

/** Preserve a normal human-edited subtitle track byte-for-byte in its words.
 * For a genuinely rolling track, use each newly revealed suffix exactly once
 * and group the incremental speech at sentence endings / reasonable spans.
 * All boundaries are derived from existing VTT cues, never AI estimates.
 */
function compactRollingCues(raw:CaptionCue[]):CaptionCue[]{
  if(raw.length<8)return raw;
  let overlaps=0,considered=0;
  for(let i=1;i<raw.length;i++){
    const a=raw[i-1],b=raw[i];
    if(b.start-a.start>8)continue;
    considered++;
    if(rollingOverlap(a.text,b.text)>=10)overlaps++;
  }
  // Avoid rewriting ordinary caption tracks with an occasional repeated word.
  if(overlaps<4 || overlaps/Math.max(1,considered)<.35)return raw;

  const pieces:CaptionCue[]=[];
  for(let i=0;i<raw.length;i++){
    const current=raw[i],prev=raw[i-1];
    const overlap=prev&&current.start-prev.start<=8 ? rollingOverlap(prev.text,current.text) : 0;
    const added=overlap?current.text.slice(overlap).trim():current.text;
    if(!added){if(pieces.length)pieces[pieces.length-1].end=Math.max(pieces[pieces.length-1].end,current.end);continue;}
    pieces.push({start:current.start,end:current.end,text:added});
  }
  const merged:CaptionCue[]=[];
  let open:CaptionCue|null=null;
  const flush=()=>{if(open && open.text.trim())merged.push(open);open=null;};
  for(const piece of pieces){
    // Timestamp is allocated within this existing displayed cue, for ordering
    // only. Word-level timing is an approximation; no new speech is written.
    const words=piece.text.split(/\s+/).filter(Boolean);
    for(let j=0;j<words.length;j++){
      const start=piece.start+(piece.end-piece.start)*j/words.length;
      const end=piece.start+(piece.end-piece.start)*(j+1)/words.length;
      if(open && start-open.end>3)flush();
      if(!open)open={start,end,text:words[j]};
      else {open.text+=' '+words[j];open.end=Math.max(open.end,end);}
      const span=end-open.start;
      const fullSentence=/[.!?。！？]["'”’)]?$/u.test(words[j]);
      // The transcript is editorially grouped only; the words remain exactly
      // those first observed in the video caption cues, in original order.
      if((fullSentence && (open.text.length>=23 || span>=3)) ||
         (span>=14 && open.text.length>=48) || open.text.length>=165)flush();
    }
  }
  flush();
  // Raw captions can overlap in display-time while their spoken content is
  // sequential. Clamp the previous end to the next existing start, but never
  // invent missing start timestamps.
  for(let i=0;i+1<merged.length;i++){
    if(merged[i+1].start>merged[i].start+.01)
      merged[i].end=Math.min(merged[i].end,merged[i+1].start);
  }
  return merged.filter(x=>x.end>x.start);
}

/** Parse YouTube VTT, including rolling auto captions. Full human cues are
 * preserved; rolling subtitles are compacted before turning them into SRT. */
export function vttToSrt(vtt:string,duration:number):TimedCaptionResult|null{
  if(!vtt||vtt.length>MAX_BYTES)return null;
  const blocks=vtt.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/g);
  const raw:CaptionCue[]=[];
  for(const block of blocks){
    const lines=block.trim().split('\n');
    const pos=lines.findIndex(l=>l.includes('-->'));
    if(pos<0)continue;
    const match=/^\s*((?:\d\d:)?\d\d:\d\d\.\d{3})\s*-->\s*((?:\d\d:)?\d\d:\d\d\.\d{3})(?:\s|$)/.exec(lines[pos]);
    if(!match)continue;
    const start=seconds(match[1]),end=seconds(match[2]);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+1.5)continue;
    const text=plain(lines.slice(pos+1).join(' '));
    if(text)raw.push({start,end,text});
  }
  raw.sort((a,b)=>a.start-b.start||a.end-b.end);
  const rolling=compactRollingCues(raw);
  if(raw.length>=12 && rolling.length<=raw.length*.8)
    console.info(JSON.stringify({event:'analysis.youtube_rolling_caption_normalized',sourceCues:raw.length,normalizedCues:rolling.length}));
  // Keep the v4.9 exact/contained normalization for non-rolling subtitles.
  // This also preserves all historical v4.9 caption regression expectations.
  const cues:CaptionCue[]=[];
  for(const c of rolling){
    const prev=cues.at(-1);
    if(prev && c.start<=prev.end+1 && (prev.text===c.text||c.text.startsWith(prev.text))){
      if(c.text.length>prev.text.length)prev.text=c.text;
      prev.end=Math.max(prev.end,c.end);continue;
    }
    if(prev && c.start<=prev.end+.5 && prev.text.includes(c.text) && c.text.length>=7){prev.end=Math.max(prev.end,c.end);continue;}
    cues.push({...c});
  }
  if(!cues.length)return null;
  const srt=cues.map((c,i)=>`${i+1}\n${clock(c.start)} --> ${clock(c.end)}\n${c.text}`).join('\n\n')+'\n';
  return {srt,count:cues.length,end:Math.max(...cues.map(c=>c.end))};
}

/** The SRT timecodes are the caption track's timecodes, not Gemini guesses. */
export function parseTimedCaptionSrt(srt:string,duration:number):TranscriptLine[]{
  const result:TranscriptLine[]=[];
  if(!srt||srt.length>MAX_BYTES)return result;
  for(const block of srt.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/g)){
    const lines=block.trim().split('\n');
    const idx=lines.findIndex(x=>x.includes('-->'));if(idx<0)continue;
    const match=/^\s*(\d\d:\d\d:\d\d[,\.]\d{3})\s*-->\s*(\d\d:\d\d:\d\d[,\.]\d{3})/.exec(lines[idx]);
    if(!match)continue;
    const startSeconds=seconds(match[1]),endSeconds=seconds(match[2]);
    const text=plain(lines.slice(idx+1).join(' '));
    if(!text||!Number.isFinite(startSeconds)||!Number.isFinite(endSeconds)||startSeconds<0||endSeconds<=startSeconds||endSeconds>duration+1.5)continue;
    result.push({id:`caption-${result.length}`,startSeconds,endSeconds:Math.min(endSeconds,duration),text,translated:false});
  }
  return result.sort((a,b)=>a.startSeconds-b.startSeconds);
}

/** Override only speech/timeline, not article/summary. Keep their existing
 * evidence for compatibility. This ensures a caption's words and timing are
 * never rephrased or shifted by the LLM after a successful analysis. */
export function preserveTimedCaptionTimeline(record:AnalysisRecord,srt:string,duration:number):number{
  const lines=parseTimedCaptionSrt(srt,duration);
  if(lines.length<3)return 0;
  const evidence=lines.map((l,i)=>({id:`timed-caption-e-${i}`,startSeconds:l.startSeconds,endSeconds:l.endSeconds,kind:'caption' as const,note:l.text}));
  record.evidence=[...record.evidence.filter(e=>!e.id.startsWith('timed-caption-e-')),...evidence];
  record.original.transcript=lines;
  record.original.timeline=lines.map((l,i)=>({id:`timed-caption-t-${i}`,text:l.text,evidenceIds:[evidence[i].id]}));
  record.edited=structuredClone(record.original);
  return lines.length;
}

export async function fetchYtDlpKoreanCaptions(videoId:string,duration:number,signal?:AbortSignal):Promise<TimedCaptionResult|null>{
  if(!videoIdPattern.test(videoId)||!Number.isFinite(duration)||duration<=0||signal?.aborted)return null;
  // On managed/cloud deployments yt-dlp may be absent: keep existing Gemini
  // fallback instead of making the whole application fail to start.
  let dir:string|undefined;
  try{
    dir=await mkdtemp(join(tmpdir(),'yva-ko-captions-'));
    const output=join(dir,'captions.%(ext)s');
    const url=`https://www.youtube.com/watch?v=${videoId}`;
    await new Promise<void>((resolve,reject)=>{
      execFile('yt-dlp',[
        '--ignore-config','--no-playlist','--skip-download',
        '--write-subs','--write-auto-subs','--sub-langs','ko,ko-KR,ko-orig',
        '--sub-format','vtt','--output',output,'--',url,
      ],{timeout:35000,maxBuffer:300000,signal},(error)=>error?reject(error):resolve());
    });
    const files=(await readdir(dir)).filter(name=>/^captions\.(?:ko|ko-KR|ko-orig)\.vtt$/.test(name));
    const results:TimedCaptionResult[]=[];
    for(const name of files){
      const vtt=await readFile(join(dir,name),'utf8');
      const parsed=vttToSrt(vtt,duration);
      if(parsed && parsed.count>=3)results.push(parsed);
    }
    results.sort((a,b)=>b.end-a.end||b.count-a.count);
    const best=results[0]??null;
    // Do not present a 20% partial caption track as the whole script.
    if(!best||best.end<duration*.72)return null;
    console.info(JSON.stringify({event:'analysis.local_youtube_captions',videoId,subtitles:best.count,lastEnd:best.end,method:'yt-dlp'}));
    return best;
  }catch(error){
    // Missing binary, YouTube rate limiting, privacy settings or video-specific
    // restrictions are normal fallbacks. Never log the raw error (may contain URLs).
    console.warn(JSON.stringify({event:'analysis.local_youtube_captions_unavailable',reason:signal?.aborted?'cancelled':error instanceof Error&&('code' in error)&&error.code==='ENOENT'?'yt_dlp_missing':'unavailable'}));
    return null;
  }finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
