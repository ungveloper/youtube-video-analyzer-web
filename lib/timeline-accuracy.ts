/**
 * Timeline time integrity is a STRUCTURAL review, not speech-to-audio alignment.
 * An LLM-supplied URL timecode is unverified even if it falls within the video.
 * Timed captions supplied by the user retain their provided time anchors.
 */
import type { Evidence, GroundedItem } from './types';

export type TimelineGap = { from: number; to: number; seconds: number };
export type TimelineTimingReview = {
  firstSeconds: number | null;
  lastStartSeconds: number | null;
  lastEndSeconds: number | null;
  gaps: TimelineGap[];
  hasSparseEnding: boolean;
};

export function timelineStartSeconds(item: GroundedItem, evidence: Evidence[]): number | null {
  if (typeof item.timeOverrideSeconds === 'number' && Number.isFinite(item.timeOverrideSeconds) && item.timeOverrideSeconds >= 0) {
    return item.timeOverrideSeconds;
  }
  const lookup = new Map(evidence.map(entry => [entry.id, entry.startSeconds]));
  const values = item.evidenceIds.map(id => lookup.get(id)).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  return values.length ? Math.min(...values) : null;
}

export function parseTimelineTime(input: string, durationSeconds: number): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if ((Boolean(match[1]) && minutes >= 60) || seconds >= 60) return null;
  const result = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(result) && result >= 0 && result <= durationSeconds ? result : null;
}

export function assessTimelineTiming(items: GroundedItem[], evidence: Evidence[], durationSeconds: number): TimelineTimingReview {
  const lookup = new Map(evidence.map(entry => [entry.id, entry]));
  const points = items.flatMap(item => {
    const start = timelineStartSeconds(item, evidence);
    if (start === null || start > durationSeconds) return [];
    const linked = item.evidenceIds.map(id => lookup.get(id)).filter((v): v is Evidence => v !== undefined);
    const end = typeof item.timeOverrideSeconds === 'number'
      ? start // Manually corrected anchors must not inherit an unrelated model end time.
      : Math.max(start, ...linked.filter(e => e.startSeconds <= durationSeconds && e.endSeconds >= e.startSeconds && e.endSeconds <= durationSeconds).map(e => e.endSeconds));
    return [{start, end}];
  }).sort((a,b) => a.start - b.start);
  const distinctStarts = [...new Set(points.map(point => point.start))];
  const threshold = Math.max(25, Math.ceil(durationSeconds * 0.12));
  const gaps:TimelineGap[] = [];
  for (let i = 1; i < distinctStarts.length; i++) {
    const from = distinctStarts[i - 1], to = distinctStarts[i];
    if (to - from > threshold) gaps.push({from,to,seconds:to-from});
  }
  const last = points.at(-1);
  const lastEnd = points.length? Math.max(...points.map(point=>point.end)):null;
  // A row at 02:48 could describe speech ending at 03:18. Judge the
  // closing gap by available END anchors, never by the final START alone.
  const endingGapThreshold=Math.max(12,Math.min(35,durationSeconds*0.1));
  return {
    firstSeconds: distinctStarts[0] ?? null,
    lastStartSeconds: last?.start ?? null,
    lastEndSeconds: lastEnd,
    gaps,
    // A missing final start is a review hint; no claim about percentage of speech heard.
    hasSparseEnding: durationSeconds > 0 && (lastEnd===null || durationSeconds-lastEnd > endingGapThreshold),
  };
}
