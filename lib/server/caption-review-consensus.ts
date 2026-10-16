import type {TranscriptLine} from '@/lib/types';

type Correction={
  index:number;
  before:string;
  after:string;
};

function normalized(text:string):string{
  return text.replace(/[\p{P}\p{S}\s]/gu,'');
}

function parseCorrections(input:unknown):Correction[]{
  if(!input||typeof input!=='object')return [];

  const raw=(input as {corrections?:unknown}).corrections;
  if(!Array.isArray(raw))return [];

  const result:Correction[]=[];
  const seen=new Set<string>();
  const variants=new Map<string,Set<string>>();

  for(const item of raw.slice(0,600)){
    if(!item||typeof item!=='object')continue;

    const value=item as {
      index?:unknown;
      before?:unknown;
      after?:unknown;
    };

    if(typeof value.index!=='number'||
       !Number.isInteger(value.index)||
       value.index<0||
       typeof value.before!=='string'||
       typeof value.after!=='string'||
       !value.before||
       !value.after||
       value.before===value.after)
      continue;

    const patch:Correction={
      index:value.index,
      before:value.before,
      after:value.after
    };

    const target=JSON.stringify([
      patch.index,patch.before
    ]);

    const signature=JSON.stringify([
      patch.index,patch.before,patch.after
    ]);

    if(!variants.has(target))
      variants.set(target,new Set());

    variants.get(target)!.add(patch.after);

    if(seen.has(signature))continue;

    seen.add(signature);
    result.push(patch);
  }

  // A model must not offer two conflicting replacements
  // for the same original phrase.
  return result.filter(patch=>
    variants.get(JSON.stringify([
      patch.index,patch.before
    ]))?.size===1
  );
}

/**
 * Two independent text-only readings.
 *
 * A word-changing patch must be supported by both.
 * A pure whitespace/punctuation patch can pass from
 * the first reading alone.
 *
 * This is agreement, NOT audio-based verification.
 */
export function captionCorrectionConsensus(
  first:unknown,
  second:unknown
):{
  corrections:Correction[];
  primaryProposed:number;
  reviewProposed:number;
  withheld:number;
}{
  const initial=parseCorrections(first);
  const independent=parseCorrections(second);

  const confirmed=new Set(
    independent.map(item=>JSON.stringify([
      item.index,item.before,item.after
    ]))
  );

  const corrections=initial.filter(item=>
    confirmed.has(JSON.stringify([
      item.index,item.before,item.after
    ])) ||
    normalized(item.before)===normalized(item.after)
  );

  return {
    corrections,
    primaryProposed:initial.length,
    reviewProposed:independent.length,
    withheld:initial.length-corrections.length
  };
}
