import 'server-only';
import {MAX_CAPTION_CHARS} from '@/lib/caption-input';
import {hasFullCaptionCoverage,parsePublicCaptionTracks,parsePublicJson3,permittedTimedTextUrl,publicCuesToSrt,selectKoreanCaptionTrack} from '@/lib/public-caption-parser';
/** Best-effort public YouTube captions. Uses no auth, cookies, database or paid API.
 * YouTube can block server-side pages or hide tracks; never fabricate subtitles.
 */
export async function fetchPublicKoreanCaptions(id:string,duration:number,signal?:AbortSignal):Promise<{srt:string;count:number;end:number}|null>{
  if(!/^[a-zA-Z0-9_-]{11}$/.test(id)||duration<30||duration>1800)return null;
  const timeout=AbortSignal.timeout(5500);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try{
    const htmlResponse=await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=ko`,{
      signal:combined,redirect:'error',cache:'no-store',headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'}
    });
    if(!htmlResponse.ok||Number(htmlResponse.headers.get('content-length')||0)>4_000_000)return null;
    const html=await htmlResponse.text();if(html.length>4_000_000)return null;
    const track=selectKoreanCaptionTrack(parsePublicCaptionTracks(html));if(!track)return null;
    const url=permittedTimedTextUrl(track.baseUrl,id);if(!url)return null;
    const captions=await fetch(url.toString(),{signal:combined,redirect:'error',cache:'no-store'});
    if(!captions.ok||Number(captions.headers.get('content-length')||0)>1_000_000)return null;
    const raw=await captions.text();if(raw.length>1_000_000)return null;
    const cues=parsePublicJson3(raw,duration);
    if(cues.length>1200||!hasFullCaptionCoverage(cues,duration))return null;
    const srt=publicCuesToSrt(cues);if(srt.length>MAX_CAPTION_CHARS)return null;
    return {srt,count:cues.length,end:Math.max(...cues.map(c=>c.endSeconds))};
  }catch(error){if(signal?.aborted)throw error;return null;}
}
