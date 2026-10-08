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
  if (content.summary.length < Math.min(3, targets.summary)) shortFields.push('핵심 요약');
  if (content.timeline.length < Math.min(4, targets.timeline)) shortFields.push('타임라인');
  if (content.article.length < Math.min(3, targets.article) || articleChars < 400) shortFields.push('아티클');
  return {
    shortFields,
    counts: { summary: content.summary.length, timeline: content.timeline.length, article: content.article.length, articleChars },
    targets,
  };
}
