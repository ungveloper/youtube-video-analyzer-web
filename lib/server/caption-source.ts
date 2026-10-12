/** Uses ONLY a user's supplied time-coded subtitles; no third-party caption retrieval. */
import type { VideoInfo } from '@/lib/types';
import type { SourceMap, SourceClaim } from '@/lib/server/evidence-pipeline';
import { parseTimedCaptions } from '@/lib/caption-input';

export function sourceFromUserCaptions(raw:string,video:VideoInfo):SourceMap {
  const cues=parseTimedCaptions(raw,video.durationSeconds);
  // Prefer speech/sentence boundaries over broad topic windows. Cue timestamps are
  // authoritative; never interpolate a new time inside a cue. Short fragmented
  // automatic captions may be joined until a sentence ends or a small window fills.
  const windowSeconds=video.durationSeconds<=300?11:video.durationSeconds<=900?18:26;
  const evidence:SourceMap['evidence']=[];
  const claims:SourceClaim[]=[];
  let group:typeof cues=[];
  const flush=()=>{
    if (!group.length) return;
    const index=evidence.length+1;
    const id=`caption-${index}`;
    const text=group.map(c=>c.text).join(' ').replace(/\s+/g,' ').slice(0,1500);
    const start=group[0].startSeconds;
    const end=group[group.length-1].endSeconds;
    evidence.push({id,startSeconds:start,endSeconds:end,kind:'caption',note:text});
    claims.push({id:`quote-${index}`,text,evidenceIds:[id],category:'원문 발화'});
    group=[];
  };
  for(const cue of cues){
    const textLength=group.reduce((sum,item)=>sum+item.text.length,0);
    const last=group.at(-1);
    const currentEndsSentence=last ? /[.!?。！？]["'”’)]?$/.test(last.text.trim()) : false;
    const silence=last ? cue.startSeconds-last.endSeconds>3 : false;
    if(group.length && (
      silence ||
      (currentEndsSentence && textLength >= 8) ||
      cue.endSeconds-group[0].startSeconds>windowSeconds ||
      textLength+cue.text.length>180
    )) flush();
    group.push(cue);
  }
  flush();
  // Actual source text from the user's captions is preserved verbatim.
  // For non-Korean captions, these are original-language quotations, NOT Korean translations.
  const transcript=cues.slice(0,1200).map((cue,i)=>({id:`caption-tr-${i}`,startSeconds:cue.startSeconds,endSeconds:cue.endSeconds,text:cue.text,translated:false}));
  return {evidence,claims,transcript,exclusions:[]};
}

export function trustedCaptionClaims(raw:unknown,original:SourceMap):SourceMap {
  if(raw===null||typeof raw!=='object') return original;
  const obj=raw as Record<string,unknown>;
  const valid=new Set(original.evidence.map(e=>e.id));
  const mapped:SourceClaim[]=[];
  for(const [i,v] of (Array.isArray(obj.claims)?obj.claims:[]).slice(0,120).entries()){
    if (!v || typeof v!=='object') continue;
    const claim=v as Record<string,unknown>;
    const refs=[...new Set((Array.isArray(claim.evidenceIds)?claim.evidenceIds:[]).filter((x):x is string=>typeof x==='string'&&valid.has(x)))];
    const content=typeof claim.text==='string'?claim.text.trim().slice(0,1200):'';
    if(!refs.length||content.length<8) continue;
    mapped.push({id:`caption-claim-${i}`,text:content,evidenceIds:refs,category:typeof claim.category==='string'?claim.category.slice(0,100):'핵심 내용'});
  }
  // Never allow model-generated timestamp edits, transcript edits, or additional evidence.
  // If claim extraction failed, the exact timed source quotes are still available.
  return {...original, claims: mapped.length>=2?mapped:original.claims};
}

export function captionClaimPrompt(source:SourceMap):string {
  return `다음은 사용자가 직접 제공한 시간 정보가 있는 자막의 발화 기록이다. YouTube 영상 자체를 다시 볼 수 없으므로 이 자막 텍스트 밖의 내용을 절대 상상하지 마라.\n
각 자막 구간의 실제 말한 내용을 빠뜨리지 말고, 논점·설명·사례·숫자·조건·전환을 하나의 구체적 주장씩 claims 배열로 분해하라. 명확한 발언만 다루고 발표자의 주장이라는 표현을 유지한다. 각 claim의 evidenceIds는 아래 원본 evidence ID에서 선택하며 없는 ID를 만들면 안 된다. 일괄 요약하거나 중복 문장으로 개수를 채우지 마라.\n
JSON 객체를 반환하라. 필수로 claims 배열을 사용하며, evidence/transcript/exclusions는 빈 배열을 보내도 된다. 서버는 자막의 진짜 시간 근거를 별도로 보존한다.\n
${JSON.stringify(source.evidence).slice(0,95000)}`;
}
