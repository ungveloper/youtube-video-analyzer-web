/** Pure parsers for publicly available YouTube caption tracks. No caption fabrication. */
export type PublicCaptionTrack={baseUrl:string;languageCode:string;kind?:string};
export type PublicCue={startSeconds:number;endSeconds:number;text:string};
function balancedJson(source:string,index:number,opening:'['|'{'):string|null{
  if(index<0||source[index]!==opening)return null;
  const stack:string[]=[];let quoted=false,escaped=false;
  for(let i=index;i<source.length&&i<index+500_000;i++){
    const c=source[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')stack.push(c);
    if(c==='}'||c===']'){
      const prior=stack.pop();if(prior!==(c==='}'?'{':'['))return null;
      if(!stack.length)return source.slice(index,i+1);
    }
  }
  return null;
}
export function parsePublicCaptionTracks(html:string):PublicCaptionTrack[]{
  const marker='"captionTracks":';const offset=html.indexOf(marker);
  if(offset<0)return [];
  const start=html.indexOf('[',offset+marker.length);
  const json=balancedJson(html,start,'[');
  if(!json)return [];
  try{
    const tracks=JSON.parse(json) as unknown;
    if(!Array.isArray(tracks))return [];
    return tracks.filter(t=>t&&typeof t==='object'&&typeof t.baseUrl==='string'&&typeof t.languageCode==='string').map(t=>({baseUrl:t.baseUrl,languageCode:t.languageCode,kind:t.kind}));
  }catch{return [];}
}
export function selectKoreanCaptionTrack(tracks:PublicCaptionTrack[]):PublicCaptionTrack|null{
  return tracks.filter(t=>/^ko(?:-|$)/i.test(t.languageCode)).sort((a,b)=>Number(a.kind==='asr')-Number(b.kind==='asr'))[0]??null;
}
export function permittedTimedTextUrl(raw:string,videoId:string):URL|null{
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:')return null;
    if(url.hostname!=='www.youtube.com'&&url.hostname!=='youtube.com'&&url.hostname!=='www.youtube-nocookie.com'&&!url.hostname.endsWith('.googlevideo.com'))return null;
    if(url.pathname!=='/api/timedtext')return null;
    const embeddedId=url.searchParams.get('v');if(embeddedId&&embeddedId!==videoId)return null;
    url.searchParams.set('fmt','json3');return url;
  }catch{return null;}
}
export function parsePublicJson3(raw:string,duration:number):PublicCue[]{
  let input:unknown;try{input=JSON.parse(raw);}catch{return [];}
  if(!input||typeof input!=='object'||!Array.isArray((input as {events?:unknown}).events))return [];
  const cues:PublicCue[]=[];
  for(const event of (input as {events:unknown[]}).events.slice(0,1400)){
    if(!event||typeof event!=='object')continue;
    const item=event as {tStartMs?:unknown;dDurationMs?:unknown;segs?:unknown};
    if(typeof item.tStartMs!=='number'||typeof item.dDurationMs!=='number'||!Array.isArray(item.segs))continue;
    const text=item.segs.map(seg=>seg&&typeof seg==='object'&&typeof seg.utf8==='string'?seg.utf8:'').join('').replace(/\s+/g,' ').trim();
    const start=item.tStartMs/1000,end=(item.tStartMs+item.dDurationMs)/1000;
    if(!text||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||start>=duration||text.length>1600)continue;
    cues.push({startSeconds:start,endSeconds:Math.min(duration,end),text});
  }
  return cues.sort((a,b)=>a.startSeconds-b.startSeconds).filter((cue,i,array)=>i===0||cue.startSeconds!==array[i-1].startSeconds||cue.text!==array[i-1].text);
}
export function hasFullCaptionCoverage(cues:PublicCue[],duration:number):boolean{
  if(cues.length<8||duration<30)return false;
  const ordered=[...cues].sort((a,b)=>a.startSeconds-b.startSeconds);
  if(ordered[0].startSeconds>Math.max(12,duration*0.15))return false;
  if(ordered.at(-1)!.endSeconds<duration*0.83)return false;
  let end=0;
  for(const cue of ordered){if(cue.startSeconds-end>Math.max(32,duration*0.20))return false;end=Math.max(end,cue.endSeconds);}
  return true;
}
const time=(seconds:number)=>{const ms=Math.max(0,Math.round(seconds*1000));const p=(v:number,n:number)=>String(v).padStart(n,'0');return `${p(Math.floor(ms/3600000),2)}:${p(Math.floor(ms/60000)%60,2)}:${p(Math.floor(ms/1000)%60,2)},${p(ms%1000,3)}`;};
export function publicCuesToSrt(cues:PublicCue[]):string{return cues.map((c,i)=>`${i+1}\n${time(c.startSeconds)} --> ${time(c.endSeconds)}\n${c.text}\n`).join('\n');}
