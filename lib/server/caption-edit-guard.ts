import type {TranscriptLine} from '@/lib/types';
import type {SourceMap} from '@/lib/server/evidence-pipeline';

const compact=(text:string)=>text.replace(/\s+/gu,'');
const normalized=(text:string)=>text.replace(/\s+/gu,' ').trim();

/**
 * A whitespace-only edit that deletes a previously separated Korean
 * word boundary is too risky for text-only inference.
 * Keep useful lexical corrections and whitespace insertions.
 */
export function guardCaptionCorrections(
  lines:TranscriptLine[],
  parsed:unknown
):{parsed:unknown;blockedSpacing:number}{
  if(!parsed||typeof parsed!=='object')
    return {parsed,blockedSpacing:0};

  const value=parsed as Record<string,unknown>;
  if(!Array.isArray(value.corrections))
    return {parsed,blockedSpacing:0};

  let blockedSpacing=0;
  const corrections=value.corrections.filter(raw=>{
    if(!raw||typeof raw!=='object')return true;
    const item=raw as Record<string,unknown>;
    const index=item.index;
    const before=item.before;
    const after=item.after;
    if(typeof index!=='number' ||
       !Number.isInteger(index) ||
       index<0 || index>=lines.length ||
       typeof before!=='string' ||
       typeof after!=='string')
      return true;

    // Only inspect a real exact-source replacement, not guesses.
    if(!lines[index].text.includes(before))return true;
    const koreanBoundary=/[가-힣]\s+[가-힣]/u;
    const beforeSpaces=(before.match(/\s+/gu)||[]).length;
    const afterSpaces=(after.match(/\s+/gu)||[]).length;
    const destructive=
      compact(before)===compact(after) &&
      beforeSpaces>afterSpaces &&
      koreanBoundary.test(before);

    if(destructive)blockedSpacing++;
    return !destructive;
  });

  return {
    parsed:{...value,corrections},
    blockedSpacing
  };
}

/**
 * An intentionally narrow Korean grammar repair.
 * Applies only to sentence-initial conjunction + demonstrative.
 * It contains no topic-specific terms, names or medical vocabulary.
 */
export function repairCaptionConjunctionSpacing(
  lines:TranscriptLine[]
):TranscriptLine[]{
  const start=/^(하지만|그러나|그런데)(이|그|저)(?=\s+[가-힣])/u;
  return lines.map(line=>{
    const fixed=line.text.replace(start,'$1 $2');
    return fixed===line.text ? line : {...line,text:fixed};
  });
}

export function auditCaptionReconciliation(
  before:SourceMap,
  after:SourceMap,
  corrected:TranscriptLine[]
):{
  synchronized:boolean;
  evidenceChanged:number;
  claimChanged:number;
  transcriptChanged:number;
  groupsChecked:number;
}{
  const fail=()=>({
    synchronized:false,
    evidenceChanged:0,
    claimChanged:0,
    transcriptChanged:0,
    groupsChecked:0
  });
  if(before.transcript.length!==corrected.length ||
     after.transcript.length!==corrected.length ||
     before.evidence.length!==after.evidence.length ||
     before.claims.length!==after.claims.length)
    return fail();

  for(let i=0;i<corrected.length;i++){
    const old=before.transcript[i];
    const now=corrected[i];
    const saved=after.transcript[i];
    if(old.startSeconds!==now.startSeconds ||
       old.endSeconds!==now.endSeconds ||
       saved.startSeconds!==now.startSeconds ||
       saved.endSeconds!==now.endSeconds ||
       saved.text!==now.text)return fail();
  }

  const originalEvidence=new Map(
    before.evidence.map(item=>[item.id,item])
  );
  const reconciledEvidence=new Map(
    after.evidence.map(item=>[item.id,item])
  );
  if(originalEvidence.size!==before.evidence.length ||
     reconciledEvidence.size!==after.evidence.length)
    return fail();

  let evidenceChanged=0;
  let groupsChecked=0;
  let matches=true;
  for(const entry of before.evidence){
    const updated=reconciledEvidence.get(entry.id);
    if(!updated ||
       entry.kind!==updated.kind ||
       entry.startSeconds!==updated.startSeconds ||
       entry.endSeconds!==updated.endSeconds)
      return fail();
    if(entry.note!==updated.note)evidenceChanged++;

    if(entry.kind!=='caption'||!entry.note?.trim())continue;
    const from=before.transcript.findIndex(
      line=>line.startSeconds===entry.startSeconds
    );
    const to=before.transcript.findIndex(
      (line,i)=>i>=from&&line.endSeconds===entry.endSeconds
    );
    if(from<0||to<from)continue;
    const sourceText=normalized(
      before.transcript.slice(from,to+1)
        .map(x=>x.text).join(' ')
    ).slice(0,1500);
    if(sourceText!==normalized(entry.note))continue;
    groupsChecked++;
    const expected=normalized(
      corrected.slice(from,to+1)
        .map(x=>x.text).join(' ')
    ).slice(0,1500);
    if(normalized(updated.note||'')!==expected)matches=false;
  }

  let claimChanged=0;
  for(let i=0;i<before.claims.length;i++){
    const old=before.claims[i];
    const revised=after.claims[i];
    if(old.id!==revised.id ||
       old.evidenceIds.join('|')!==revised.evidenceIds.join('|'))
      return fail();
    if(old.text!==revised.text)claimChanged++;
  }
  const transcriptChanged=before.transcript.filter(
    (line,i)=>line.text!==corrected[i].text
  ).length;

  return {
    synchronized:matches &&
      (transcriptChanged===0 ||
       (groupsChecked>0 && evidenceChanged>0)),
    evidenceChanged,
    claimChanged,
    transcriptChanged,
    groupsChecked
  };
}
