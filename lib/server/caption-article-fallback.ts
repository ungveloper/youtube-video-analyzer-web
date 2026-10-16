import type {Evidence,GroundedItem} from '@/lib/types';

/**
 * Transcript-backed article fallback.
 * It preserves every available caption note and its evidence ID.
 * It never invents a summary, fact, timecode, or topic term.
 */
export function captionArticleFromEvidence(
  evidence:Evidence[]
):GroundedItem[]{
  const cues=evidence
    .filter(e=>e.kind==='caption'&&Boolean(e.note?.trim()))
    .sort((a,b)=>a.startSeconds-b.startSeconds);

  const article:GroundedItem[]=[];
  let group:Evidence[]=[];

  const clock=(seconds:number)=>{
    const s=Math.max(0,Math.floor(seconds));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };

  const flush=()=>{
    if(!group.length)return;

    const start=group[0].startSeconds;

    article.push({
      id:`caption-recovery-${article.length}`,
      title:`시간 지정 원문 · ${clock(start)}부터`,
      text:group.map(e=>e.note!.trim()).join(' '),
      evidenceIds:group.map(e=>e.id)
    });

    group=[];
  };

  for(const cue of cues){
    const chars=group.reduce(
      (n,e)=>n+(e.note?.length??0),0
    );

    if(group.length&&(
      group.length>=5 ||
      chars+(cue.note?.length??0)>650 ||
      cue.endSeconds-group[0].startSeconds>48
    ))flush();

    group.push(cue);
  }

  flush();
  return article;
}
