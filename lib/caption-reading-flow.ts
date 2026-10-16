import type {Evidence,GroundedItem} from './types';

/**
 * Read-only sentence presentation for timed captions.
 *
 * The original transcript, timestamps and evidence remain untouched.
 * A sentence may reference several original caption cues.
 * Splitting inside a cue cannot establish word-level timing.
 */
const terminal=/[.!?。！？][”’"']?$/u;

function sentencePieces(input:string):string[]{
  const text=input.replace(/\s+/gu,' ').trim();
  const output:string[]=[];
  let from=0;

  for(const match of text.matchAll(
    /[.!?。！？][”’"']?(?=\s+|$)/gu
  )){
    const end=match.index+match[0].length;
    const part=text.slice(from,end).trim();
    if(part)output.push(part);
    from=end;
  }

  const rest=text.slice(from).trim();
  if(rest)output.push(rest);
  return output;
}

export function readableCaptionTimeline(
  items:GroundedItem[],
  evidence:Evidence[]
):GroundedItem[]{
  if(!items.length)return items;

  const lookup=new Map(evidence.map(e=>[e.id,e]));

  // Do not recombine manually edited entries, custom timestamps,
  // titled AI summaries, or multiple-source entries.
  const compatible=items.every(item=>
    !item.edited &&
    item.timeOverrideSeconds===undefined &&
    !item.title?.trim() &&
    item.evidenceIds.length===1 &&
    Boolean(item.text.trim()) &&
    lookup.get(item.evidenceIds[0])?.kind==='caption'
  );

  if(!compatible)return items;

  const rows=items.map(item=>({
    item,
    cue:lookup.get(item.evidenceIds[0])!
  })).sort((a,b)=>
    a.cue.startSeconds-b.cue.startSeconds
  );

  const output:GroundedItem[]=[];
  let words:string[]=[];
  let ids:string[]=[];
  let firstStart=0;
  let lastEnd=0;

  const flush=()=>{
    if(!words.length)return;

    output.push({
      id:`readable-caption-${output.length}`,
      text:words.join(' '),
      evidenceIds:[...ids]
    });

    words=[];
    ids=[];
    firstStart=0;
    lastEnd=0;
  };

  for(const {item,cue} of rows){
    // Never join across a significant silence or an
    // implausibly long sentence.
    if(words.length && (
      cue.startSeconds-lastEnd>4.5 ||
      cue.startSeconds-firstStart>30 ||
      words.join(' ').length+item.text.length>420
    ))flush();

    for(const part of sentencePieces(item.text)){
      if(!words.length)firstStart=cue.startSeconds;

      words.push(part);

      if(!ids.includes(cue.id))
        ids.push(cue.id);

      lastEnd=cue.endSeconds;

      if(terminal.test(part))flush();
    }
  }

  flush();
  return output;
}
