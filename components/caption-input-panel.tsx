'use client';
import {useMemo,useState} from 'react';
import {toast} from 'sonner';
import { MAX_CAPTION_CHARS,parseTimedCaptions } from '@/lib/caption-input';

export function CaptionInputPanel({value,onChange,duration,disabled}:{value:string;onChange:(v:string)=>void;duration:number;disabled:boolean}) {
  const [open,setOpen]=useState(false);
  const [fileError,setFileError]=useState('');
  const status=useMemo(()=>{
    if (!value.trim()) return null;
    try { const cues=parseTimedCaptions(value,duration);const last=cues[cues.length-1];return {valid:true,message:`시간 근거 ${cues.length}개 · 첫 시작 ${cues[0].startSeconds.toFixed(1)}초 · ${last.endSeconds===last.startSeconds?'마지막 시작 '+last.startSeconds.toFixed(1)+'초 (끝 시각 미확인)':'마지막 종료 '+last.endSeconds.toFixed(1)+'초'}`}; }
    catch(e){return {valid:false,message:e instanceof Error?e.message:'자막 형식 오류'};}
  },[value,duration]);
  return <section className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
    <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-slate-200" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span>선택: SRT/VTT 또는 시간 지정 원문 붙여넣기 (빠른 1회 분석)</span><span aria-hidden="true">{open?'−':'+'}</span>
    </button>
    {open&&<div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-slate-400">내가 사용할 권한이 있는 SRT/VTT 파일이나 유튜브의 스크립트 표시 화면에서 확보한 시간 지정 발언을 직접 붙여넣으세요. 예: [0:00] 실제 발언, [0:33] 다음 발언. 자동 수집은 하지 않습니다. 시간 지정 원문을 사용하면 타임라인의 원문 문구와 시각을 AI 요약으로 바꾸지 않으며, 텍스트 AI 호출 한 번으로 문서를 작성합니다. 입력 내용은 AI 제공자에 전달되지만 서버 DB에는 저장하지 않습니다.</p>
      <input type="file" accept=".srt,.vtt,.txt,text/plain" disabled={disabled} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200" onChange={async e=>{
        const f=e.target.files?.[0];if(!f)return;
        if(f.size>500_000){setFileError('파일이 너무 큽니다.');toast.error('자막 파일이 너무 큽니다.');return;}
        const content=await f.text();if(content.length>MAX_CAPTION_CHARS){setFileError('자막 글자 수가 제한을 초과합니다.');toast.error('자막 글자 수 제한을 초과했습니다.');return;}
        setFileError('');onChange(content);toast.success('자막 파일을 불러왔습니다.');
      }}/>
      <textarea disabled={disabled} value={value} onChange={e=>onChange(e.target.value)} maxLength={MAX_CAPTION_CHARS} rows={5} placeholder={'[0:00] 첫 번째 실제 발언\n[0:33] 다음 실제 발언\n\n또는 SRT/VTT 형식'} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs leading-5 text-slate-100 outline-none focus:border-indigo-400"/>
      <p className={`text-xs ${status&&!status.valid||fileError?'text-rose-300':'text-slate-400'}`} role="status">{fileError||status?.message||'자막을 입력하지 않으면 기존 Gemini 영상 URL 분석을 사용합니다.'}</p>
      {value&&<button type="button" className="text-xs text-indigo-300 hover:underline" disabled={disabled} onClick={()=>{onChange('');setFileError('');toast.info('입력한 자막을 지웠습니다.');}}>입력한 자막 지우기</button>}
    </div>}
  </section>;
}
