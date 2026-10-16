import type {TranscriptLine} from '@/lib/types';

/**
 * Topic-neutral structural cleanup.
 * No medical, financial, gaming, product or other topic dictionary.
 * Semantic corrections belong to the contextual proofreader.
 */
function normalizedWord(word:string):string{
  return word.normalize('NFC')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu,'')
    .toLocaleLowerCase();
}

export function normalizeCaptionErrors(
  lines:TranscriptLine[]
):{
  lines:TranscriptLine[];
  changed:number;
  repeated:number;
}{
  const output:TranscriptLine[]=[];
  let changed=0;
  let repeated=0;

  for(const line of lines){
    const words=line.text.trim().split(/\s+/u).filter(Boolean);
    const compacted:string[]=[];

    // Only remove >=3 identical consecutive long words.
    // Two repetitions may be genuine spoken emphasis.
    for(let i=0;i<words.length;){
      const key=normalizedWord(words[i]);
      let count=1;

      if(key.length>=3 && /^\p{L}+$/u.test(key)){
        while(i+count<words.length &&
          normalizedWord(words[i+count])===key){
          count++;
        }
      }

      if(count>=3){
        compacted.push(words[i+count-1]);
        repeated+=count-1;
      }else{
        compacted.push(...words.slice(i,i+count));
      }

      i+=count;
    }

    let resultWords=compacted;
    const previous=output.at(-1);

    // Remove a repeated sentence-ending word at an
    // immediately adjacent subtitle boundary.
    if(previous &&
       line.startSeconds<=previous.endSeconds+1){
      const previousLast=previous.text.trim()
        .split(/\s+/u).at(-1);

      if(previousLast &&
         /^[\p{L}]{4,}[.!?。！？]$/u.test(previousLast)){
        let duplicated=0;

        while(duplicated<resultWords.length-1 &&
          resultWords[duplicated]===previousLast){
          duplicated++;
        }

        if(duplicated>0){
          resultWords=resultWords.slice(duplicated);
          repeated+=duplicated;
        }
      }
    }

    const text=resultWords.join(' ') || line.text;
    if(text!==line.text)changed++;

    output.push({...line,text});
  }

  return {lines:output,changed,repeated};
}
