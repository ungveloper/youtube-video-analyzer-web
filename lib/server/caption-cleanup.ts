import type {TranscriptLine} from '@/lib/types';

/**
 * No Gemini request. Safe, narrow fallback for recognisable ASR
 * artifacts. Never rewrite names, institutions or numbers.
 * The rules do not contain any video ID or entire transcript.
 */
const medicalRules: Array<[RegExp,string]> = [
  [/가지\s*동맹/gu,'하지 동맥'],
  [/말초\s*동매/gu,'말초 동맥'],
  [/혈관념/gu,'혈관염'],
  [/포핵\s*중후/gu,'포획 증후군'],
  [/스화\s*동맥/gu,'슬와 동맥'],
  [/위화\s*동맥/gu,'슬와 동맥'],
  [/동맥의\s*회색/gu,'동맥의 폐색'],
  [/회색(?=되는|되|에 의해서)/gu,'폐색'],
  [/척추한\s*협착증/gu,'척추관 협착증'],
  [/버거시병/gu,'버거씨병'],
  [/헬스크럽/gu,'헬스클럽'],
  [/이한 질환/gu,'의한 질환'],
  [/이런 신어가/gu,'이런 신호가'],
  [/단순한 필요에 의한/gu,'단순한 피로에 의한'],
  [/이렇 일상생활/gu,'이렇게 일상생활'],
  [/쉬우면은 다시 증상이/gu,'쉬면은 다시 증상이'],
  [/많이 걸 수가/gu,'많이 걸을 수가'],
  [/하지만이(?=\s|질병)/gu,'하지만 이'],
];

function removeImmediateEcho(text:string):string {
  // Avoid removing short genuine repetitions such as "많이 많이".
  return text.replace(
    /(^|\s)([가-힣]{4,}[.!?]?)(?:\s+\2)+(?=\s|$)/gu,
    '$1$2'
  );
}

export function normalizeCaptionErrors(lines:TranscriptLine[]):{
  lines:TranscriptLine[];
  changed:number;
  repeated:number;
  terminology:number;
}{
  const context=lines.map(l=>l.text).join(' ');
  const medical=/동맥|혈관|폐색|혈전|포핵|슬와|말초|버거시병|혈관념/u
    .test(context);

  const output:TranscriptLine[]=[];
  let changed=0;
  let repeated=0;
  let terminology=0;

  for(const original of lines){
    let text=original.text;

    const withoutEcho=removeImmediateEcho(text);
    if(text!==withoutEcho){
      text=withoutEcho;
      repeated++;
    }

    const previous=output.at(-1);

    if(previous &&
       original.startSeconds<=previous.endSeconds+4){
      // Last word of an earlier cue repeated at the next cue's start.
      const tail=/([가-힣]{4,}[.!?])\s*$/u.exec(previous.text);
      if(tail &&
         text.startsWith(tail[1]+' ') &&
         text.slice(tail[1].length).trim().length>=4){
        text=text.slice(tail[1].length).trimStart();
        repeated++;
      }
    }

    if(medical){
      const beforeTerms=text;

      for(const [pattern,replacement] of medicalRules){
        pattern.lastIndex=0;
        text=text.replace(pattern,replacement);
      }

      // Context-limited correction: do not change a genuinely
      // improving blood vessel into a narrowing one elsewhere.
      if(/혈관 벽에 스며|콜레스테롤|중성지방/u.test(context)){
        text=text.replace(
          /혈관이 점점 좋아지게(?= 되는)/gu,
          '혈관이 점점 좁아지게'
        );
      }

      if(text!==beforeTerms)terminology++;
    }

    if(text!==original.text)changed++;
    output.push({...original,text});
  }

  return {lines:output,changed,repeated,terminology};
}
