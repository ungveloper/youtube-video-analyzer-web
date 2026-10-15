/** Evidence-preserving repair for segmented video-ASR results.
 * Keep audible-looking DISTINCT text when Gemini gave intersecting time estimates.
 * All timestamps remain model estimates, never certified subtitle alignment.
 * Production contains no video-specific phrases, external transcripts, or secrets.
 */
import type {TranscriptLine} from './types';
import type {SpeechSegment} from './segmented-speech';

export type VideoSpeechOutcome={segment:SpeechSegment;parsed?:unknown;failure?:string};
export type VideoReviewWindow={from:number;to:number};
const norm=(s:string)=>s.replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
function similar(a:string,b:string):boolean{
  const x=norm(a),y=norm(b);
  if(x===y)return true;
  if(Math.min(x.length,y.length)>=12 && Math.min(x.length,y.length)/Math.max(x.length,y.length)>=.72 && (x.includes(y)||y.includes(x)))return true;
  if(Math.min(x.length,y.length)<15)return false;
  // Minor spelling variation must not create a second copy of the same sentence.
  const grams=(s:string)=>{const m=new Map<string,number>();for(let i=0;i<s.length-1;i++){const k=s.slice(i,i+2);m.set(k,(m.get(k)||0)+1);}return m;};
  const ga=grams(x),gb=grams(y);let intersection=0;
  for(const [k,v] of ga)intersection+=Math.min(v,gb.get(k)||0);
  return 2*intersection/(x.length+y.length-2)>=.88;
}
function plausible(start:unknown,end:unknown,content:unknown,length:number):content is string{
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>length+.001||typeof content!=='string'||content.trim().length<4||content.length>1100)return false;
  const chars=content.trim().replace(/\s/g,'').length;
  return chars<=Math.max(40,(end-start)*15+12);
}
function rowToLine(row:unknown,from:number,to:number,id:string,duration:number):TranscriptLine|null{
  if(!row||typeof row!=='object')return null;
  const r=row as {startSeconds?:unknown;endSeconds?:unknown;text?:unknown};
  if(!plausible(r.startSeconds,r.endSeconds,r.text,to-from))return null;
  const start=from+(r.startSeconds as number),end=from+(r.endSeconds as number);
  if(start<0||end>duration+.001)return null;
  return {id,startSeconds:start,endSeconds:Math.min(duration,end),text:(r.text as string).trim(),translated:false};
}
function rawLines(value:unknown):unknown[]{
  if(!value||typeof value!=='object')return [];
  const lines=(value as {lines?:unknown}).lines;
  return Array.isArray(lines)?lines.slice(0,120):[];
}
function uniqueAppend(result:TranscriptLine[],candidate:TranscriptLine):boolean{
  // Overlap in SECONDS is not the same as the same spoken WORDS.
  if(result.some(line=>similar(line.text,candidate.text)))return false;
  result.push(candidate);return true;
}
export type SalvageReport={lines:TranscriptLine[];seen:number;recovered:number;invalid:number;outsideCore:number;duplicates:number;overlappingRecovered:number;perClip:Array<{index:number;returned:number;recovered:number;invalid:number;outsideCore:number;duplicates:number}>};
export function salvageRejectedSpeech(outcomes:VideoSpeechOutcome[],segments:SpeechSegment[],existing:TranscriptLine[],duration:number):SalvageReport{
  const result=existing.map(x=>({...x}));
  let seen=0,recovered=0,invalid=0,outsideCore=0,duplicates=0,overlappingRecovered=0;
  const perClip:SalvageReport['perClip']=[];
  const byIndex=new Map(segments.map(s=>[s.index,s]));
  for(const outcome of outcomes){
    if(outcome.failure||!outcome.parsed)continue;
    const seg=byIndex.get(outcome.segment.index);if(!seg)continue;
    const rows=rawLines(outcome.parsed);let cr=0,ci=0,co=0,cd=0;
    for(const [i,row] of rows.entries()){
      seen++;
      const candidate=rowToLine(row,seg.from,seg.to,`salvaged-${seg.index}-${i}`,duration);
      if(!candidate){invalid++;ci++;continue;}
      // A neighboring context interval is not proof this clip owns the phrase.
      // Do not revive rejected context rows with guessed placement.
      const ownerFrom=seg.coreFrom??seg.from,ownerTo=seg.coreTo??seg.to;
      if(candidate.startSeconds<ownerFrom-.5||candidate.startSeconds>=ownerTo+.5){outsideCore++;co++;continue;}
      const overlaps=result.some(x=>Math.max(0,Math.min(x.endSeconds,candidate.endSeconds)-Math.max(x.startSeconds,candidate.startSeconds))>.8);
      if(!uniqueAppend(result,candidate)){duplicates++;cd++;continue;}
      if(overlaps)overlappingRecovered++;
      recovered++;cr++;
    }
    perClip.push({index:seg.index,returned:rows.length,recovered:cr,invalid:ci,outsideCore:co,duplicates:cd});
  }
  return {lines:result.sort((a,b)=>a.startSeconds-b.startSeconds),seen,recovered,invalid,outsideCore,duplicates,overlappingRecovered,perClip};
}

/** Two independent listens cover the central 39–82% of a 2–5 minute video.
 * This broadens evidence without hardcoding one video's timing or speech.
 * Calls may be skipped by the existing shared deadline or 429 quota guard.
 */
export function planSpeechCoverageWindows(duration:number):VideoReviewWindow[]{
  if(!Number.isFinite(duration)||duration<120||duration>300)return [];
  const width=Math.min(52,Math.max(34,Math.round(duration*.23)));
  const windows=[Math.round(duration*.39),Math.round(duration*.59)].map(from=>({from,to:Math.min(duration,from+width)}));
  return windows.filter((w,i)=>w.to-w.from>=25&&(i===0||w.from>windows[0].from+10));
}
export function makeSpeechCoverageRequest(uri:string,window:VideoReviewWindow){
  return [
    {type:'video' as const,uri,processing:{type:'static' as const,start_offset:`${window.from}s`,end_offset:`${window.to}s`}},
    {type:'text' as const,text:`원본 YouTube 영상의 ${window.from}~${window.to}초만 직접 듣고, 그 안에서 실제 들리는 모든 한국어 발언을 순서대로 완결된 문장으로 받아써라. 이것은 독립적인 누락 검증이다. 다른 모델의 전사문은 주어지지 않는다. 짧은 질문, 예시, 질병 간 비교, 앞뒤 문장의 연결 발언도 빠뜨리지 말고 영상 끝부분까지 확인하라. 요약·의역·창작·영상에 없는 의학 정보 추가는 금지한다. startSeconds와 endSeconds는 반드시 이 클립 시작을 0으로 둔 상대시간이다. 각 문장 시작을 실제 음성에 맞춰 추정하되 확실하지 않으면 문장을 지어내지 마라. JSON 객체 {"lines":[{"startSeconds":0,"endSeconds":3,"text":"이 클립에서 실제 들린 발언"}]}만 출력하라.`},
  ];
}
export function extractCoverageReviewRows(response:unknown,window:VideoReviewWindow,duration:number):{lines:TranscriptLine[];invalid:number}{
  const accepted:TranscriptLine[]=[];let invalid=0;
  for(const [i,row] of rawLines(response).entries()){
    const candidate=rowToLine(row,window.from,window.to,`coverage-${window.from}-${i}`,duration);
    if(!candidate){invalid++;continue;}
    if(!uniqueAppend(accepted,candidate))continue;
  }
  return {lines:accepted.sort((a,b)=>a.startSeconds-b.startSeconds),invalid};
}

export type IndependentMergeReport={lines:TranscriptLine[];added:number;duplicates:number;corrections:number;reason:string};
/** Preserve distinct content even when earlier Gemini timings conflict.
 * Move existing estimates only when TWO independently heard whole sentences
 * corroborate a consistent 3–28s shift. Never silently shift from one match.
 */
export function mergeIndependentCoverage(existing:TranscriptLine[],reviewed:TranscriptLine[],window:VideoReviewWindow,duration:number):IndependentMergeReport{
  const result=existing.map(x=>({...x})),matching:Array<{oldIndex:number;row:TranscriptLine;delta:number}>=[];
  const unmatched:TranscriptLine[]=[];let duplicates=0;
  for(const line of reviewed){
    if(line.startSeconds<window.from||line.endSeconds>window.to+.001||line.endSeconds>duration||!line.text.trim())continue;
    const idx=result.findIndex(x=>similar(x.text,line.text));
    if(idx<0){if(!unmatched.some(x=>similar(x.text,line.text)))unmatched.push(line);continue;}
    duplicates++;
    if(norm(result[idx].text).length>=12 && !matching.some(x=>x.oldIndex===idx))matching.push({oldIndex:idx,row:line,delta:line.startSeconds-result[idx].startSeconds});
  }
  let corrections=0,reason='insufficient_matching_anchors';
  const plausibleShift=matching.filter(x=>Math.abs(x.delta)>=3&&Math.abs(x.delta)<=28&&x.row.startSeconds>=60);
  if(plausibleShift.length>=2){
    const shifts=plausibleShift.map(x=>x.delta).sort((a,b)=>a-b),median=shifts[Math.floor(shifts.length/2)];
    const agreeing=plausibleShift.filter(x=>Math.abs(x.delta-median)<=2);
    if(agreeing.length>=2){
      for(const match of agreeing){
        const old=result[match.oldIndex];
        const nextStart=match.row.startSeconds,nextEnd=match.row.endSeconds;
        if(nextStart>=0&&nextEnd<=duration&&nextEnd>nextStart){old.startSeconds=nextStart;old.endSeconds=nextEnd;corrections++;}
      }
      reason='two_independent_matching_sentences';
    }else reason='inconsistent_shifts';
  }
  let added=0;
  for(const item of unmatched){if(uniqueAppend(result,item))added++;}
  return {lines:result.sort((a,b)=>a.startSeconds-b.startSeconds),added,duplicates,corrections,reason};
}


/** Adapt recovery to OBSERVED audio gaps, not to one fixed video or two
 * hardwired middle windows. Starts/ends must be considered: in v4.2 a
 * successful middle review prevented any retry of a missing 00:00–00:33.
 * No speech is fabricated; every returned phrase still comes from Gemini.
 */
export function planSpeechRepairWindows(lines:TranscriptLine[],duration:number):VideoReviewWindow[]{
  if(!Number.isFinite(duration)||duration<120||duration>300)return [];
  const ordered=lines.filter(l=>Number.isFinite(l.startSeconds)&&Number.isFinite(l.endSeconds)&&l.startSeconds>=0&&l.endSeconds>l.startSeconds&&l.endSeconds<=duration).sort((a,b)=>a.startSeconds-b.startSeconds);
  if(!ordered.length)return [{from:0,to:Math.min(48,duration)},{from:Math.max(0,Math.floor(duration*.54)),to:Math.min(duration,Math.floor(duration*.54)+48)}];
  type Candidate=VideoReviewWindow&{score:number;label:string};
  const candidates:Candidate[]=[];
  let cursor=0;
  for(let i=0;i<=ordered.length;i++){
    const next=i<ordered.length?ordered[i].startSeconds:duration;
    const gap=next-cursor;
    const isHead=i===0,isTail=i===ordered.length;
    const threshold=isHead?9:isTail?8:9;
    if(gap>=threshold){
      // A single 52s crop used to hide BOTH ends of a 60-90s transcript hole.
      // Cover the entire missing interior with two/three bounded, overlapping
      // real-video clips. This is evidence discovery, not generated text.
      if(!isHead&&!isTail&&gap>=54){
        const count=Math.min(3,Math.max(2,Math.ceil((gap+8)/48)));
        for(let piece=0;piece<count;piece++){
          const left=cursor+(gap*piece/count);
          const right=cursor+(gap*(piece+1)/count);
          const from=Math.max(0,Math.floor(left-4));
          const to=Math.min(duration,Math.min(from+52,Math.ceil(right+4)));
          // Priority over a short transition-cue review: a missing minute
          // must consume the first two recovery slots, not just one.
          candidates.push({from,to,score:gap+42-piece, label:`long-gap-${piece}`});
        }
      }else{
        let from=Math.max(0,Math.floor(cursor-4));
        let to=Math.min(duration,Math.ceil(next+4));
        if(isTail)from=Math.max(0,Math.min(from,duration-35));
        if(to-from>52){
          const mid=(cursor+next)/2;
          from=Math.max(0,Math.floor(mid-26));to=Math.min(duration,from+52);
        }
        candidates.push({from,to,score:gap+(isHead?28:isTail?15:cursor>=60?10:3),label:isHead?'start':isTail?'end':'interior'});
      }
    }
    if(i<ordered.length)cursor=Math.max(cursor,ordered[i].endSeconds);
  }
  candidates.sort((a,b)=>b.score-a.score||a.from-b.from);
  // Short omissions can hide behind nearly continuous timestamps. When a
  // speaker begins with a sequencing/contrast cue, a previous counterpart
  // may have been omitted even though there is no >=9s silent-looking gap.
  // This only PLANS a real audio re-listen; no transcript words are invented.
  const transition=ordered.flatMap((line,i)=>{
    if(i===0||line.startSeconds<60||line.startSeconds>duration-12)return [];
    const phrase=line.text.trim().replace(/^[\s"'“”]+/u,'');
    if(!/^(?:그다음에|그 다음에|반면에|그에 반해|이에 비해|다음으로)(?:[\s,.!?]|$)/u.test(phrase))return [];
    const pause=line.startSeconds-ordered[i-1].endSeconds;
    if(pause<-.8||pause>9)return [];
    const from=Math.max(0,Math.floor(line.startSeconds-14));
    const to=Math.min(duration,Math.ceil(line.startSeconds+14));
    return to-from>=22?[{from,to,score:Math.min(8,pause)+Math.min(7,line.text.length/15)}]:[];
  }).sort((a,b)=>b.score-a.score||a.from-b.from)[0]??null;
  const selected:VideoReviewWindow[]=[];
  const append=(w:VideoReviewWindow)=>{
    const length=w.to-w.from;
    if(length<8)return;
    // A 26-28s focused re-listen and a broader middle review serve different
    // purposes: don't treat containment as duplication. Reject only near-
    // identical windows with strong overlap in BOTH directions.
    if(selected.some(s=>{
      const overlap=Math.max(0,Math.min(s.to,w.to)-Math.max(s.from,w.from));
      return overlap>=Math.min(s.to-s.from,length)*.75 && overlap>=Math.max(s.to-s.from,length)*.75;
    }))return;
    if(selected.length<3)selected.push({from:w.from,to:w.to});
  };
  // Existing large gaps remain highest priority. One focused transition
  // review can occupy an otherwise unused slot, never >3 video calls.
  for(const c of candidates)append(c);
  if(transition)append(transition);
  // Preserve both pre-existing middle cross-check windows even when one short
  // transition review was added. No transition => original two-call behavior.
  if(selected.length<(transition?3:2))for(const w of planSpeechCoverageWindows(duration))append(w);
  return selected;
}
