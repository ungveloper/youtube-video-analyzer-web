'use client';
import {useMemo,useState} from 'react';
import { MAX_CAPTION_CHARS,parseTimedCaptions } from '@/lib/caption-input';

export function CaptionInputPanel({value,onChange,duration,disabled}:{value:string;onChange:(v:string)=>void;duration:number;disabled:boolean}) {
  const [open,setOpen]=useState(false);
  const [fileError,setFileError]=useState('');
  const status=useMemo(()=>{
    if (!value.trim()) return null;
    try { const cues=parseTimedCaptions(value,duration);return {valid:true,message:`시간 근거 ${cues.length}개 · ${cues[0].startSeconds.toFixed(1)}초부터 ${cues[cues.length-1].endSeconds.toFixed(1)}초까지`}; }
    catch(e){return {valid:false,message:e instanceof Error?e.message:'자막 형식 오류'};}
  },[value,duration]);
  return <section className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
    <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-slate-200" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>
      <span>선택: 내가 보유한 SRT/VTT 자막으로 정밀 분석</span><span aria-hidden="true">{open?'−':'+'}</span>
    </button>
    {open&&<div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-slate-400">라이브위키처럼 원본 발화 중심으로 분석할 수 있습니다. 이용 권한이 있는 시간 지정 자막만 직접 제공하세요. 유튜브 자막을 자동 수집하지 않습니다. 입력은 AI 제공자에게 분석 목적으로 전달되며 서버 DB에 저장하지 않습니다.</p>
      <input type="file" accept=".srt,.vtt,.txt,text/plain" disabled={disabled} className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200" onChange={async e=>{
        const f=e.target.files?.[0];if(!f)return;
        if(f.size>500_000){setFileError('파일이 너무 큽니다.');return;}
        const content=await f.text();if(content.length>MAX_CAPTION_CHARS){setFileError('자막 글자 수가 제한을 초과합니다.');return;}
        setFileError('');onChange(content);
      }}/>
      <textarea disabled={disabled} value={value} onChange={e=>onChange(e.target.value)} maxLength={MAX_CAPTION_CHARS} rows={5} placeholder={'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\n첫 번째 발화 내용\n\n00:00:05.000 --> 00:00:10.000\n두 번째 발화 내용'} className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs leading-5 text-slate-100 outline-none focus:border-indigo-400"/>
      <p className={`text-xs ${status&&!status.valid||fileError?'text-rose-300':'text-slate-400'}`} role="status">{fileError||status?.message||'자막을 입력하지 않으면 기존 Gemini 영상 URL 분석을 사용합니다.'}</p>
      {value&&<button type="button" className="text-xs text-indigo-300 hover:underline" disabled={disabled} onClick={()=>{onChange('');setFileError('');}}>입력한 자막 지우기</button>}
    </div>}
  </section>;
}
