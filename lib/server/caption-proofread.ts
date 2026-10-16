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
  return `당신은 한국어 영상 자막의 오타 교정 전문가입니다.
영상 제목: ${title.slice(0,180)}

다음은 유튜브에서 이미 추출된 시간 지정 자동 자막입니다.
원본 음성은 제공되지 않으므로 실제로 듣고 확인했다고 주장하지 마세요.

규칙:
1. 발음 인식 오류, 명백한 맞춤법 오류, 문맥상 확실한 전문용어만 교정합니다.
2. 문장 추가, 삭제, 요약, 의역, 어순 변경을 금지합니다.
3. 숫자, 비율, 기관명, 인명은 추측해서 변경하지 마세요.
4. 앞뒤 문맥을 확인하되 수정은 반드시 기존 자막 구간 안에서만 합니다.
5. 확신할 수 없는 표현은 그대로 둡니다.
6. 변경한 항목만 {index, text} 형태로 반환합니다.
7. index는 아래 입력의 번호를 그대로 사용합니다.
8. JSON 객체 {"corrections":[{"index":0,"text":"교정문"}]}만 출력합니다.

원본 자막:
${JSON.stringify(lines.map((line,index)=>({
  index,
  startSeconds:line.startSeconds,
  text:line.text,
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
