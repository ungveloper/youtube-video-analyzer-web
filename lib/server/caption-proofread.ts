import type {TranscriptLine} from '@/lib/types';

export const captionProofreadFormat={
  type:'text',
  mime_type:'application/json',
  schema:{
    type:'object',
    properties:{
      corrections:{
        type:'array',
        items:{
          type:'object',
          properties:{
            index:{type:'integer'},
            text:{type:'string'},
          },
          required:['index','text'],
        },
      },
    },
    required:['corrections'],
  },
} as const;

export function captionProofreadPrompt(
  lines:TranscriptLine[],
  title:string
):string{
  return `역할: 모든 분야의 한국어 영상에 적용하는 범용 자막 교열자.

영상 제목: ${title.slice(0,180)}

목표:
유튜브 자동 자막의 발음 오인식, 철자, 띄어쓰기,
문맥상 명백한 단어 오류만 수정한다.

주제는 미리 정해져 있지 않다.
영상 제목과 전체 자막에서 실제 주제를 파악한다.
특정 분야의 고정 용어 사전이나 사전 가정에 의존하지 않는다.

교정 원칙:
1. 전체 자막에 반복 등장하는 표현을 먼저 확인해
   용어·제품명·기술명·고유명사의 표기 일관성을 살핀다.
2. 일반적인 단어라도 문맥에 어긋나면 교정을 검토한다.
3. 원래 화자의 어순, 말투, 발언 내용을 유지한다.
4. 요약, 의역, 문장 추가·삭제, 새로운 사실 삽입은 금지한다.
5. 숫자·단위·비율·인명·기관명·브랜드명은
   추측으로 변경하지 않는다.
6. 해당 자막 구간 내부에서만 고친다.
   서로 다른 시각의 발언을 이동하거나 합치지 않는다.
7. 원본 음성은 제공되지 않았다.
   발음을 실제로 확인했다고 주장하지 않는다.
8. 확실하지 않은 오타는 수정하지 않는다.
9. 오타를 고친 문장만 index와 text로 제출한다.
10. 수정할 곳이 없다면 corrections를 빈 배열로 둔다.

출력은 오직 JSON 객체:
{"corrections":[{"index":0,"text":"교정된 원문"}]}

전체 자막:
${JSON.stringify(lines.map((line,index)=>({
  index,
  startSeconds:line.startSeconds,
  text:line.text
})))}`;
}

const normalize=(s:string)=>
  s.replace(/[\p{P}\p{S}\s]/gu,'');

function editDistance(a:string,b:string):number{
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++){
      next[j]=Math.min(
        next[j-1]+1,
        previous[j]+1,
        previous[j-1]+(a[i-1]===b[j-1]?0:1)
      );
    }
    previous=next;
  }
  return previous[b.length];
}

function protectedNumbers(text:string):string{
  return JSON.stringify(
    text.match(/\d+(?:[.,]\d+)?%?/g)??[]
  );
}

function protectedInstitutions(text:string):string{
  return JSON.stringify(
    text.match(/[가-힣A-Za-z]{2,}(?:병원|의원|원장|교수)/g)??[]
  );
}

function acceptable(original:string,revised:string):boolean{
  if(!revised||revised.length>1000||/[\r\n<>]/.test(revised))
    return false;
  if(protectedNumbers(original)!==protectedNumbers(revised))
    return false;
  if(protectedInstitutions(original)!==protectedInstitutions(revised))
    return false;

  const before=normalize(original);
  const after=normalize(revised);
  if(before===after||!before||!after)return false;

  const allowance=Math.min(
    12,
    Math.max(2,Math.ceil(before.length*.18))
  );

  if(Math.abs(before.length-after.length)>allowance)
    return false;

  return editDistance(before,after)<=allowance;
}

export function applyCaptionProofread(
  lines:TranscriptLine[],
  parsed:unknown
):{
  lines:TranscriptLine[];
  accepted:number;
  rejected:number;
}{
  const result=lines.map(line=>({...line}));
  const changes=parsed&&typeof parsed==='object'
    ?(parsed as {corrections?:unknown}).corrections
    :undefined;

  if(!Array.isArray(changes))
    return {lines:result,accepted:0,rejected:0};

  const seen=new Set<number>();
  let accepted=0;
  let rejected=0;

  for(const raw of changes.slice(0,lines.length*2)){
    if(!raw||typeof raw!=='object'){
      rejected++;
      continue;
    }

    const item=raw as {index?:unknown;text?:unknown};
    const index=item.index;

    if(typeof index!=='number'||
       !Number.isInteger(index)||
       index<0||
       index>=lines.length||
       seen.has(index)||
       typeof item.text!=='string'){
      rejected++;
      continue;
    }

    seen.add(index);

    if(!acceptable(lines[index].text,item.text.trim())){
      rejected++;
      continue;
    }

    result[index].text=item.text.trim();
    accepted++;
  }

  return {lines:result,accepted,rejected};
}

export function correctedLinesToSrt(
  lines:TranscriptLine[]
):string{
  const clock=(seconds:number)=>{
    const ms=Math.max(0,Math.round(seconds*1000));
    return [
      String(Math.floor(ms/3600000)).padStart(2,'0'),
      String(Math.floor(ms/60000)%60).padStart(2,'0'),
      String(Math.floor(ms/1000)%60).padStart(2,'0'),
    ].join(':')+','+String(ms%1000).padStart(3,'0');
  };

  return lines.map((line,i)=>
    `${i+1}\n${clock(line.startSeconds)} --> ${clock(line.endSeconds)}\n${line.text}`
  ).join('\n\n')+'\n';
}
