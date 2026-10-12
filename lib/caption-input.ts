/** User-supplied, time-coded subtitle parsing. No YouTube scraping or remote download. */
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
  if (unique.length<2) throw new Error('시간 정보가 포함된 SRT 또는 VTT 자막을 읽지 못했습니다. 일반 텍스트만으로는 시간 근거를 만들 수 없습니다.');
  return unique;
}
