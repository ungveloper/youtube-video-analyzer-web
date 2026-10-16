import type {TranscriptLine} from '@/lib/types';
import type {SourceMap} from '@/lib/server/evidence-pipeline';

const spacing=(s:string)=>s.replace(/\s+/g,' ').trim();

function hasBatchim(s:string):boolean{
  const last=s.charCodeAt(s.length-1);
  return Number.isFinite(last) &&
    last>=0xac00 && last<=0xd7a3 &&
    (last-0xac00)%28!==0;
}

/**
 * Only repair an -이라는/-라는 suffix after the noun was changed
 * by an accepted edit. Never rewrite arbitrary unedited speech.
 */
function adjustParticle(original:string,corrected:string):string{
  if(original===corrected)return corrected;
  const pattern=/([가-힣]{2,}?)(이라는|라는)(?=\s|[.,!?;:]|$)/gu;
  const before=[...original.matchAll(pattern)];
  const after=[...corrected.matchAll(pattern)];
  if(before.length!==after.length)return corrected;

  let value=corrected;
  for(let i=after.length-1;i>=0;i--){
    const old=before[i],next=after[i];
    const priorWord=old[1],newWord=next[1];
    if(priorWord===newWord || next[2]!=='라는' ||
       !hasBatchim(newWord))continue;
    // An original vowel-final + 라는 or an explicit
    // + 이라는 is evidence of the intended nominal particle.
    if(old[2]!=='이라는' &&
       !(old[2]==='라는'&&!hasBatchim(priorWord)))
      continue;
    const offset=next.index;
    if(typeof offset!=='number')continue;
    value=value.slice(0,offset)+newWord+'이라는'+
      value.slice(offset+next[0].length);
  }
  return value;
}

export function repairCaptionQuotationParticles(
  original:TranscriptLine[],
  corrected:TranscriptLine[]
):TranscriptLine[]{
  if(original.length!==corrected.length)return corrected;
  return corrected.map((line,i)=>{
    const previous=original[i];
    if(previous.startSeconds!==line.startSeconds ||
       previous.endSeconds!==line.endSeconds)
      return line;
    return {...line,text:adjustParticle(previous.text,line.text)};
  });
}

/**
 * Rebuild source evidence wording from corrected captions without
 * changing the established claim/evidence identifiers or timecodes.
 * Only rewrite a group if its original cues match the ledger.
 */
export function reconcileCaptionSource(
  source:SourceMap,
  corrected:TranscriptLine[]
):SourceMap{
  const prior=source.transcript;
  if(prior.length!==corrected.length ||
     prior.some((line,i)=>
       line.startSeconds!==corrected[i].startSeconds ||
       line.endSeconds!==corrected[i].endSeconds))
    return source;

  const evidence=source.evidence.map(item=>{
    if(item.kind!=='caption'||!item.note?.trim())return item;
    const start=prior.findIndex(
      line=>line.startSeconds===item.startSeconds
    );
    if(start<0)return item;
    const end=prior.findIndex(
      (line,i)=>i>=start&&line.endSeconds===item.endSeconds
    );
    if(end<start)return item;
    const existing=spacing(prior.slice(start,end+1)
      .map(line=>line.text).join(' ')).slice(0,1500);
    if(existing!==spacing(item.note))return item;
    const revised=spacing(corrected.slice(start,end+1)
      .map(line=>line.text).join(' ')).slice(0,1500);
    return {...item,note:revised};
  });

  const originals=new Map(source.evidence.map(e=>[e.id,e]));
  const updated=new Map(evidence.map(e=>[e.id,e]));
  const claims=source.claims.map(claim=>{
    if(claim.evidenceIds.length!==1)return claim;
    const id=claim.evidenceIds[0];
    const priorEvidence=originals.get(id);
    const revisedEvidence=updated.get(id);
    if(!priorEvidence||!revisedEvidence ||
       !priorEvidence.note||!revisedEvidence.note ||
       priorEvidence.note===revisedEvidence.note)
      return claim;
    if(spacing(claim.text)!==spacing(priorEvidence.note) &&
       claim.category!=='원문 발화')
      return claim;
    return {...claim,text:revisedEvidence.note};
  });
  const transcript=prior.map((line,i)=>({
    ...line,text:corrected[i].text
  }));
  return {...source,evidence,claims,transcript};
}
