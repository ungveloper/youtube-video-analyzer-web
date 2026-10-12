import type { AnalysisContent } from '@/lib/types';
import type { SourceMap } from '@/lib/server/evidence-pipeline';

/** A structural coverage indicator, NOT factual truth certification. */
export function assessSourceCoverage(source:SourceMap,content:AnalysisContent,duration:number,composed:boolean) {
  const all=new Set(source.evidence.map(e=>e.id));
  const touched=new Set([...content.summary,...content.timeline,...content.article].flatMap(item=>item.evidenceIds).filter(id=>all.has(id)));
  const coveragePercent=all.size?Math.round(touched.size/all.size*100):0;
  const articleChars=content.article.reduce((n,x)=>n+x.text.trim().length,0);
  const minimumClaims=Math.min(8,Math.max(3,Math.round(duration/60)));
  const minimumChars=Math.min(1350,Math.max(350,Math.round(duration*2)));
  const qualityStatus:'review'|'partial'= composed && source.claims.length>=minimumClaims && coveragePercent>=40 && articleChars>=minimumChars?'review':'partial';
  return {qualityStatus,coveragePercent,articleChars,sourceClaims:source.claims.length};
}
/** Ensures all uncovered timed-caption segments remain readable, instead of vanishing in LLM summarization. */
export function includeMissingCaptionTimeline(source:SourceMap,content:AnalysisContent):AnalysisContent {
  const used=new Set(content.timeline.flatMap(x=>x.evidenceIds));
  const extra=source.evidence.filter(e=>!used.has(e.id) && e.kind==='caption' && e.note?.trim()).map((e,i)=>({
    id:`original-caption-${i}`,title:'원문 자막 · 추가 구간',text:e.note||'',evidenceIds:[e.id],
  }));
  const firstTime=(ids:string[])=>Math.min(...ids.map(id=>source.evidence.find(e=>e.id===id)?.startSeconds??Infinity));
  return {...content,timeline:[...content.timeline,...extra].sort((a,b)=>firstTime(a.evidenceIds)-firstTime(b.evidenceIds))};
}
