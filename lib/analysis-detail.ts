import type { AnalysisContent } from '@/lib/types';

// Editorial targets, not hard requirements: never manufacture claims to hit a count.
export type DetailTargets = { summary: number; timeline: number; article: number };
export function detailTargets(durationSeconds: number): DetailTargets {
  if (durationSeconds <= 300) return { summary: 4, timeline: 6, article: 4 };
  if (durationSeconds <= 900) return { summary: 5, timeline: 9, article: 6 };
  return { summary: 6, timeline: 12, article: 8 };
}
export function assessDetail(content: AnalysisContent, durationSeconds: number) {
  const targets = detailTargets(durationSeconds);
  const articleChars = content.article.reduce((n, item) => n + item.text.trim().length, 0);
  const shortFields: string[] = [];
  if (content.summary.length < targets.summary) shortFields.push('핵심 요약');
  if (content.timeline.length < targets.timeline) shortFields.push('타임라인');
  if (content.article.length < targets.article || articleChars < (durationSeconds <= 300 ? 1100 : durationSeconds <= 900 ? 2000 : 3200)) shortFields.push('아티클');
  return {
    shortFields,
    counts: { summary: content.summary.length, timeline: content.timeline.length, article: content.article.length, articleChars },
    targets,
  };
}


// A *density* check to decide whether an extra, explicitly disclosed free call
// could be worthwhile. It is NOT a claim that generated statements are true.
export function needsDeepening(content: AnalysisContent, durationSeconds: number): boolean {
  const targets = detailTargets(durationSeconds);
  const chars = content.article.reduce((sum, section) => sum + section.text.trim().length, 0);
  const minArticleChars = durationSeconds <= 300 ? 1100 : durationSeconds <= 900 ? 2000 : 3200;
  return content.summary.length < targets.summary || content.timeline.length < targets.timeline || content.article.length < targets.article || chars < minArticleChars;
}

// Cap character contribution so repeated filler cannot dominate the decision.
export function qualityDensityScore(content: AnalysisContent, durationSeconds: number): number {
  const targets=detailTargets(durationSeconds);
  const ratio=(value:number,target:number)=>Math.min(1,value/target);
  const articleChars=content.article.reduce((n,x)=>n+x.text.trim().length,0);
  const baseChars=durationSeconds<=300?1100:durationSeconds<=900?2000:3200;
  return 25*ratio(content.summary.length,targets.summary)+25*ratio(content.timeline.length,targets.timeline)+25*ratio(content.article.length,targets.article)+25*ratio(articleChars,baseChars);
}
