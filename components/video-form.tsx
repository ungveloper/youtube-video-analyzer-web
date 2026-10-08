'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input,Button } from '@/components/ui/primitives';
import { extractVideoId } from '@/lib/youtube';
import type { QuotaInfo } from '@/lib/types';
export function VideoForm(){const router=useRouter();const [input,setInput]=useState('');const [error,setError]=useState('');const [quota,setQuota]=useState<QuotaInfo|null>(null);
useEffect(()=>{let active=true;fetch('/api/quota',{cache:'no-store'}).then(r=>r.json()).then(q=>{if(active)setQuota(q as QuotaInfo)}).catch(()=>{});return()=>{active=false}},[]);
return <form onSubmit={e=>{e.preventDefault();const id=extractVideoId(input);if(!id){setError('올바른 YouTube 영상 ID 또는 URL을 입력해주세요.');return;}setError('');router.push(`/analyze/${id}`)}} className="mx-auto mt-9 max-w-2xl rounded-2xl border border-slate-700 bg-[#141b29] p-3 shadow-2xl shadow-black/30 sm:p-4"><label htmlFor="video-input" className="mb-2 block text-left text-xs font-semibold text-slate-400">YouTube 영상 ID 또는 URL</label><div className="flex flex-col gap-2 sm:flex-row"><Input id="video-input" value={input} onChange={e=>setInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." autoComplete="off"/><Button type="submit" className="min-w-32">영상 확인 →</Button></div>{error&&<p role="alert" className="mt-3 text-left text-sm text-rose-300">{error}</p>}<div className="mt-3 flex justify-between gap-3 text-xs text-slate-500"><span>최대 30분 · 완료된 분석은 로컬 저장</span><span>{quota?.enabled?`오늘 남은 ${quota.remaining}/3회`:'분석 API 설정 확인 필요'}</span></div></form>}
