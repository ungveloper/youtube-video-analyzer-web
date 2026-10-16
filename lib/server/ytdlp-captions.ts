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

/** Preserve the provider's real cue boundaries and chronology. Only collapse
 * adjacent EXACT/CONTAINED rolling YouTube VTT cues; never synthesize words. */
export function vttToSrt(vtt:string,duration:number):TimedCaptionResult|null{
  if(!vtt||vtt.length>MAX_BYTES)return null;
  const blocks=vtt.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/g);
  const cues:Array<{start:number;end:number;text:string}>=[];
  for(const block of blocks){
    const lines=block.trim().split('\n');
    const pos=lines.findIndex(l=>l.includes('-->'));
    if(pos<0)continue;
    const match=/^\s*((?:\d\d:)?\d\d:\d\d\.\d{3})\s*-->\s*((?:\d\d:)?\d\d:\d\d\.\d{3})(?:\s|$)/.exec(lines[pos]);
    if(!match)continue;
    const start=seconds(match[1]),end=seconds(match[2]);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+1.5)continue;
    const text=plain(lines.slice(pos+1).join(' '));
    if(!text)continue;
    const prev=cues.at(-1);
    if(prev && start<=prev.end+1 && (prev.text===text||text.startsWith(prev.text))){
      if(text.length>prev.text.length)prev.text=text;
      prev.end=Math.max(prev.end,end);
      continue;
    }
    // An already displayed longer rolling cue may contain its late fragment.
    if(prev && start<=prev.end+.5 && prev.text.includes(text) && text.length>=7){prev.end=Math.max(prev.end,end);continue;}
    cues.push({start,end,text});
  }
  if(!cues.length)return null;
  cues.sort((a,b)=>a.start-b.start||a.end-b.end);
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
