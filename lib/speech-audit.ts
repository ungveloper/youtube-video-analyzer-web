/** Bounded, evidence-preserving checks for Gemini-estimated Korean speech timing.
 * Review clips are REAL video inputs. No captions or audio are manufactured.
 * A second Gemini estimate is not certified word-level forced alignment.
 */
import type { TranscriptLine } from './types';

export type AuditWindow = {from:number;to:number};
const normalized=(s:string)=>s.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
const valid=(line:TranscriptLine,duration:number)=>Number.isFinite(line.startSeconds)&&Number.isFinite(line.endSeconds)&&line.startSeconds>=0&&line.endSeconds>line.startSeconds&&line.endSeconds<=duration&&!!line.text.trim();
const overlaps=(a:TranscriptLine,b:TranscriptLine)=>Math.max(0,Math.min(a.endSeconds,b.endSeconds)-Math.max(a.startSeconds,b.startSeconds));

/** Prioritize INTERIOR gaps that can hide 1-2 short sentences. A long quiet
 * intro/outro is less informative than a hole surrounded by known utterances. */
export function chooseSpeechGapAudit(lines:TranscriptLine[],duration:number,minGap=8):AuditWindow|null{
 const sorted=lines.filter(l=>valid(l,duration)).sort((a,b)=>a.startSeconds-b.startSeconds);
 if(sorted.length<5)return null;
 let best:AuditWindow|null=null;let bestScore=-Infinity;
 for(let i=1;i<sorted.length;i++){
   const from=sorted[i-1].endSeconds,to=sorted[i].startSeconds,span=to-from;
   if(span<minGap)continue;
   const score=Math.min(45,span)+(from>=60?4:0)+(from<duration*0.85?2:0);
   if(score>bestScore){best={from,to};bestScore=score;}
 }
 if(!best){const tailFrom=sorted.at(-1)!.endSeconds;if(duration-tailFrom>=23)best={from:tailFrom,to:duration};}
 if(!best)return null;
 // Keep the audit under 42 seconds even for a very large unknown hole.
 if(best.to-best.from>36){const middle=(best.from+best.to)/2;return {from:Math.max(0,Math.floor(middle-18)),to:Math.min(duration,Math.ceil(middle+18))};}
 return best;
}

/** Strictly accept ONLY new speech within the observed hole. It cannot
 * overwrite earlier words, shift known anchors, or duplicate neighboring text. */
export function mergeGapAuditedLines(existing:TranscriptLine[],reviewed:TranscriptLine[],hole:AuditWindow,duration:number):{lines:TranscriptLine[];added:number;rejected:number}{
 const result=[...existing],known=new Set(existing.map(l=>normalized(l.text)));
 let added=0,rejected=0;
 for(const item of reviewed){
   if(!valid(item,duration)||item.startSeconds<hole.from-0.25||item.startSeconds>=hole.to+0.25||item.endSeconds>hole.to+1){rejected++;continue;}
   const key=normalized(item.text);
   if(key.length<6||known.has(key)||result.some(e=>{const text=normalized(e.text);return (key.length>=12&&(text.includes(key)||key.includes(text)))||overlaps(item,e)>0.8;})){rejected++;continue;}
   result.push(item);known.add(key);added++;
 }
 return {lines:result.sort((a,b)=>a.startSeconds-b.startSeconds),added,rejected};
}

/** Choose one suspicious 24s window AFTER 1:00, weighted by implausibly fast
 * model time estimates. Do not assume any speech occurred in an empty region. */
export function planSpeechClockAudit(lines:TranscriptLine[],duration:number):AuditWindow|null{
 if(duration<120)return null;
 const sorted=lines.filter(l=>valid(l,duration)).sort((a,b)=>a.startSeconds-b.startSeconds);
 if(sorted.length<8)return null;
 let selected:AuditWindow|null=null,score=-Infinity;
 for(const line of sorted){
   if(line.startSeconds<60||line.startSeconds>duration-9)continue;
   const from=Math.max(60,Math.floor(line.startSeconds)-4),to=Math.min(duration,from+24);
   const candidates=sorted.filter(x=>x.startSeconds>=from&&x.endSeconds<=to);
   if(candidates.length<2)continue;
   const rates=candidates.map(x=>x.text.replace(/\s/g,'').length/Math.max(1,x.endSeconds-x.startSeconds));
   const suspect=rates.filter(x=>x>9).length*5+Math.max(...rates)/10;
   const middleProximity=1-Math.abs((from+to)/2-duration*0.57)/duration;
   const measure=suspect+Math.min(5,candidates.length)*0.1+middleProximity;
   if(measure>score){score=measure;selected={from,to};}
 }
 return selected;
}

/** Repeat *the same* quote in the second listen to avoid editing content or
 * finding loosely related paraphrases at different seconds. */
export function makeSpeechClockAuditRequest(uri:string,window:AuditWindow,lines:TranscriptLine[]){
 const references=lines.filter(x=>x.startSeconds>=window.from&&x.endSeconds<=window.to).slice(0,12)
   .map(x=>x.text.replace(/[\n\r]/g,' ').slice(0,220));
 return [
  {type:'video' as const,uri,processing:{type:'static' as const,start_offset:`${window.from}s`,end_offset:`${window.to}s`}},
  {type:'text' as const,text:`이 입력은 원본 ${window.from}~${window.to}초의 실제 영상 클립입니다. 아래 발언은 1차 AI 전사라 내용과 시각 모두 검증 전입니다. 반드시 이 클립에서 소리를 다시 듣고 해당 발언이 실제로 들리는 경우에만 시작과 끝 시각을 추정하세요. 텍스트를 보고 시간을 계산하거나 발언을 만들어 내지 마세요. 원문의 단어를 고치거나 요약하지 말고, 일치하는 원문 전체를 text에 그대로 복사하세요. 없는 발언은 제외하세요. 시각은 원본 영상 시간이 아니라 클립의 처음이 0인 상대 초이며, 최소 2개의 서로 다른 발언이 확인되면 반환하세요. 결과: {"lines":[{"startSeconds":0,"endSeconds":3,"text":"원문과 똑같은 발언"}]}\n확인 대상:\n${references.map((s,i)=>`${i+1}. ${s}`).join('\n')}`},
 ];
}

/** Shift only when >=2 exact quote matches independently corroborate a
 * consistent 1.5-7 second offset in the short re-listen window. Keep order
 * and original words. This is conservative model cross-check, not forced align. */
export function applySpeechClockAudit(lines:TranscriptLine[],response:unknown,window:AuditWindow,duration:number):{lines:TranscriptLine[];corrections:number;reason:string}{
 const obj=response!==null&&typeof response==='object'?response as {lines?:unknown}:{};
 if(!Array.isArray(obj.lines))return {lines,corrections:0,reason:'invalid_response'};
 const candidates=lines.map((l,i)=>({l,i})).filter(x=>valid(x.l,duration)&&x.l.startSeconds>=window.from&&x.l.endSeconds<=window.to);
 const matches:{index:number;shift:number}[]=[],claimed=new Set<number>();
 for(const raw of obj.lines.slice(0,30)){
   if(!raw||typeof raw!=='object')continue;
   const r=raw as {text?:unknown;startSeconds?:unknown;endSeconds?:unknown};
   if(typeof r.text!=='string'||typeof r.startSeconds!=='number'||typeof r.endSeconds!=='number'||!Number.isFinite(r.startSeconds)||!Number.isFinite(r.endSeconds)||r.startSeconds<0||r.endSeconds<=r.startSeconds||r.endSeconds>window.to-window.from+.001)continue;
   const quote=normalized(r.text);if(quote.length<12)continue;
   const found=candidates.find(x=>!claimed.has(x.i)&&normalized(x.l.text)===quote);
   if(!found)continue;
   const shift=window.from+r.startSeconds-found.l.startSeconds;
   if(Math.abs(shift)>7)continue;
   claimed.add(found.i);matches.push({index:found.i,shift});
 }
 if(matches.length<2)return {lines,corrections:0,reason:'insufficient_exact_quotes'};
 const values=matches.map(x=>x.shift).sort((a,b)=>a-b),median=values[Math.floor(values.length/2)];
 if(Math.abs(median)<1.5||matches.some(x=>Math.abs(x.shift-median)>1.5))return {lines,corrections:0,reason:'no_consistent_shift'};
 // Shift the whole bounded cluster (including sentences too short to match).
 const copy=lines.map(x=>({...x}));const selected=new Set(candidates.map(x=>x.i));
 for(const {i} of candidates){
   const line=copy[i],start=line.startSeconds+median,end=line.endSeconds+median;
   if(start<window.from||end>window.to||start<0||end>duration)return {lines,corrections:0,reason:'outside_review_window'};
   line.startSeconds=start;line.endSeconds=end;
 }
 const ordered=copy.map((x,i)=>({x,i})).sort((a,b)=>a.x.startSeconds-b.x.startSeconds);
 for(let i=1;i<ordered.length;i++){
   const a=ordered[i-1],b=ordered[i];
   if((selected.has(a.i)!==selected.has(b.i))&&a.x.endSeconds>b.x.startSeconds+0.6)return {lines,corrections:0,reason:'neighbor_collision'};
 }
 return {lines:copy,corrections:candidates.length,reason:'consistent_video_relisten'};
}
