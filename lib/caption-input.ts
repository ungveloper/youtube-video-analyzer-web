/** Time-coded SRT/VTT parsing. Remote caption retrieval is isolated in server/public-captions.ts. */
export type CaptionCue = { startSeconds: number; endSeconds: number; text: string };
export const MAX_CAPTION_CHARS = 180_000;
const stamp = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some(v => !Number.isFinite(v) || v < 0)) return null;
  if (nums.slice(1).some(v => v >= 60)) return null;
  const seconds = parts.length === 3 ? nums[0]*3600 + nums[1]*60 + nums[2] : nums[0]*60 + nums[1];
  return Number.isFinite(seconds) ? seconds : null;
};
function cleanText(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
    .replace(/[ \t]+/g,' ').replace(/\n+/g,' ').trim().slice(0,1600);
}
/** Parses user-pasted time-stamped transcript lines, e.g. YouTube's transcript panel.
 * Accepted layouts: "0:33 Text spoken" or a timestamp line followed by text.
 * Does not fetch or scrape transcripts; caller must provide the source text.
 */
export function parsePastedTranscript(input:string,videoDurationSeconds:number):CaptionCue[]{
  const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n').map(x=>x.trim());
  const chunks:Array<{startSeconds:number;text:string[]}>=[];
  for(const line of lines){
    if(!line || /^\[(?:music|applause|음악|박수)\]$/i.test(line))continue;
    const match=line.match(/^\[?(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]?(?:\s+(.+))?$/);
    const start=match?stamp(match[1]):null;
    if(start!==null && start>=0 && start<videoDurationSeconds){
      chunks.push({startSeconds:start,text:match?.[2]?[match[2]]:[]});
    }else if(chunks.length){chunks[chunks.length-1].text.push(line);}
  }
  if(chunks.length<2)return [];
  const result:CaptionCue[]=[];
  for(let i=0;i<chunks.length;i++){
    const item=chunks[i],next=chunks[i+1];
    // A copied transcript contains start stamps only. Do not pretend the final
    // utterance runs to the end of the video when no ending stamp exists.
    const end=next?Math.min(videoDurationSeconds,next.startSeconds):item.startSeconds;
    const text=cleanText(item.text.join(' '));
    if(text && end>=item.startSeconds && end-item.startSeconds<=120)
      result.push({startSeconds:item.startSeconds,endSeconds:end,text});
  }
  return result;
}

/** Parses SRT, WebVTT and most files with HH:MM:SS.mmm --> HH:MM:SS.mmm cues. */
export function parseTimedCaptions(input: string, videoDurationSeconds: number): CaptionCue[] {
  if (!input || input.length > MAX_CAPTION_CHARS) throw new Error(`자막 파일은 ${MAX_CAPTION_CHARS.toLocaleString()}자 이하만 지원합니다.`);
  if (!(videoDurationSeconds > 0 && videoDurationSeconds <= 1800)) throw new Error('영상 길이를 확인할 수 없습니다.');
  const text = input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const blocks = text.split(/\n\s*\n/);
  const parsed: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(x=>x.trim()).filter(Boolean);
    const idx = lines.findIndex(line=>line.includes('-->'));
    if (idx<0) continue;
    const [left,right] = lines[idx].split('-->').map(x=>x.trim());
    const start = stamp(left.split(/\s/)[0]);
    const end = stamp(right.split(/\s/)[0]);
    if (start===null || end===null || end<=start || start>=videoDurationSeconds+3) continue;
    const cueText=cleanText(lines.slice(idx+1).join(' '));
    if (!cueText) continue;
    parsed.push({startSeconds:start,endSeconds:Math.min(end,videoDurationSeconds),text:cueText});
    if (parsed.length>1200) throw new Error('자막 구간이 너무 많습니다. 1,200개 이하만 지원합니다.');
  }
  parsed.sort((a,b)=>a.startSeconds-b.startSeconds);
  const unique: CaptionCue[]=[];
  for (const cue of parsed) {
    if (unique.length && cue.startSeconds===unique[unique.length-1].startSeconds && cue.text===unique[unique.length-1].text) continue;
    unique.push(cue);
  }
  if (unique.length>=2) return unique;
  const pasted=parsePastedTranscript(input,videoDurationSeconds);
  if(pasted.length>=2)return pasted;
  throw new Error('SRT/VTT 또는 0:00 + 발언 텍스트 형태의 시간 지정 원문을 확인할 수 없습니다. 시간 없는 텍스트는 타임라인 근거로 사용할 수 없습니다.');
}
