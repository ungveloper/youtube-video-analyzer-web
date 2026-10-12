import type { AnalysisContent } from '@/lib/types';
import type { SourceMap } from '@/lib/server/evidence-pipeline';

/** Diagnostics reflect source distribution and writing completeness, never medical/factual correctness. */
export function assessSourceCoverage(source: SourceMap, content: AnalysisContent, duration: number, composed: boolean) {
  const sourceIds = new Set(source.evidence.map(e => e.id));
  const references = new Set([...content.summary, ...content.timeline, ...content.article].flatMap(item => item.evidenceIds).filter(id => sourceIds.has(id)));
  const coveragePercent = sourceIds.size ? Math.round(references.size / sourceIds.size * 100) : 0;
  const articleChars = content.article.reduce((n, item) => n + item.text.trim().length, 0);
  const lastTimestamp = Math.max(0, ...source.evidence.map(e => e.endSeconds));
  const sourceEndPercent = duration > 0 ? Math.min(100, Math.round(lastTimestamp / duration * 100)) : 0;
  const sourceBuckets = new Set(source.evidence.map(e => Math.max(0, Math.min(3, Math.floor(e.startSeconds / duration * 4)))));
  const articleText = content.article.map(item => item.text.trim()).join('\n');
  const timelineText = content.timeline.map(item => item.text.trim()).join('\n');
  // Avoid presenting a duplicated evidence list as a standalone explanatory article.
  const duplicatedArticle = articleText.length > 0 && articleText === timelineText;
  const minArticleChars = duration <= 300 ? 650 : duration <= 900 ? 1200 : 2200;
  const minimumClaims = duration <= 300 ? 5 : duration <= 900 ? 8 : 12;
  // Source distribution is a review hint, not proof that the content is missing.
  const sourceIncomplete = source.claims.length < minimumClaims || sourceBuckets.size < 4 || sourceEndPercent < 76;
  const articleConcise = articleChars < minArticleChars;
  const articleIncomplete = !composed || !content.summary.length || !content.timeline.length || !content.article.length || duplicatedArticle;
  // Hard failures require a missing/duplicated document; a coarse timeline alone
  // cannot certify incomplete analysis. Sparse coverage remains an advisory.
  const qualityStatus: 'review' | 'partial' = !composed || !content.article.length || duplicatedArticle || !content.summary.length || !content.timeline.length ? 'partial' : 'review';
  return { qualityStatus, coveragePercent, articleChars, sourceClaims: source.claims.length, sourceEndPercent, sourceBuckets: sourceBuckets.size, sourceIncomplete, articleIncomplete, articleConcise, duplicatedArticle };
}

/** Original caption segments remain accessible when the model omits one in a composed timeline. */
export function includeMissingCaptionTimeline(source: SourceMap, content: AnalysisContent): AnalysisContent {
  const used = new Set(content.timeline.flatMap(x => x.evidenceIds));
  const extra = source.evidence.filter(e => !used.has(e.id) && e.kind === 'caption' && e.note?.trim()).map((e, i) => ({
    id: `original-caption-${i}`, title: '원문 자막 · 추가 구간', text: e.note || '', evidenceIds: [e.id],
  }));
  const firstTime = (ids: string[]) => Math.min(...ids.map(id => source.evidence.find(e => e.id === id)?.startSeconds ?? Infinity));
  return {...content, timeline: [...content.timeline, ...extra].sort((a,b) => firstTime(a.evidenceIds) - firstTime(b.evidenceIds))};
}

/** One-call URL analysis still needs chronology checks; a completed API response
 * isn't evidence of complete video coverage. This is only a structural audit. */
export function assessSinglePassCoverage(evidence:SourceMap['evidence'], content:AnalysisContent, duration:number){
  const used=new Set(content.timeline.flatMap(x=>x.evidenceIds));
  const referenced=evidence.filter(e=>used.has(e.id));
  const buckets=new Set(referenced.map(e=>Math.min(3,Math.floor(e.startSeconds / duration * 4))));
  const latestEnd=Math.max(0,...referenced.map(e=>e.endSeconds));
  const lastTimelinePercent=duration?Math.min(100,Math.round(latestEnd/duration*100)):0;
  const expectedTimeline=duration<=300?9:duration<=900?12:16;
  const needsReview=content.timeline.length<expectedTimeline || buckets.size<4 || lastTimelinePercent<85;
  // Only an actual severe tail gap warrants the 'partial' badge.
  const incomplete=lastTimelinePercent<60;
  return {incomplete,needsReview,lastTimelinePercent,buckets:buckets.size,timelineCount:content.timeline.length};
}
