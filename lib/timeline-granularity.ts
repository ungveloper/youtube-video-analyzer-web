/** Evidence-led timeline granularity. No synthetic timecodes or extra AI calls. */
import type { Evidence, GroundedItem } from './types';

export type AtomicClaim = { id: string; text: string; evidenceIds: string[]; category: string };
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
const signature = (s: string): string => clean(s).replace(/[\s.,!?。·:;…“”\"'’]/g, '').toLowerCase();
const meaningful = (text: string): boolean => clean(text).length >= 14 && /[가-힣A-Za-z0-9]/.test(text);

/** Always display a verified start time; for videos shorter than an hour, 00:00. */
export function timelineTime(seconds: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function order(items: GroundedItem[], evidence: Evidence[]): GroundedItem[] {
  const times = new Map(evidence.map(e => [e.id, e.startSeconds]));
  const start = (item: GroundedItem) => Math.min(...item.evidenceIds.map(id => times.get(id) ?? Infinity));
  return items.filter(item => item.evidenceIds.some(id => times.has(id)))
    .sort((a, b) => start(a) - start(b));
}

/**
 * Two-stage mode: retain each source claim as a separate line rather than letting
 * the composer collapse multiple claims into one topic paragraph. This uses only
 * source evidence timestamps; it never guesses speech timing between anchors.
 */
export function timelineFromSourceClaims(claims: AtomicClaim[], evidence: Evidence[], authored: GroundedItem[]): GroundedItem[] {
  const lookup = new Map(evidence.map(e => [e.id, e]));
  const seen = new Set<string>();
  const atomic: GroundedItem[] = [];
  for (const [index, claim] of claims.entries()) {
    const refs = [...new Set(claim.evidenceIds)].filter(id => lookup.has(id));
    if (!refs.length || !meaningful(claim.text)) continue;
    const key = signature(claim.text);
    if (seen.has(key)) continue;
    seen.add(key);
    const matching = authored.filter(item => refs.some(id => item.evidenceIds.includes(id)));
    // A composed item referring to one verified claim can be used verbatim;
    // merged, multi-claim paragraphs cannot be timestamped sentence-by-sentence.
    const exclusive = matching.find(item => claims.filter(c => c.evidenceIds.includes(refs[0])).length === 1 && item.evidenceIds.length === 1 && refs.length === 1
      && item.evidenceIds[0] === refs[0] && meaningful(item.text) && item.text.length <= 340);
    atomic.push({id:`atomic-${index}`, title:'', text:exclusive?.text ?? clean(claim.text), evidenceIds:refs});
  }
  // If a source map was too coarse, prefer the existing verified timeline rather
  // than replacing a richer result with fewer lines.
  return atomic.length >= authored.length && atomic.length > 0 ? order(atomic, evidence) : order(authored, evidence);
}

/**
 * One-pass URL mode: where a timeline paragraph cites multiple DISTINCT time
 * evidence entries, show each sufficiently descriptive evidence note as its own
 * line. Never interpolate times within a broad interval or paraphrase facts.
 */
export function timelineFromEvidenceNotes(authored: GroundedItem[], evidence: Evidence[]): GroundedItem[] {
  const lookup = new Map(evidence.map(e => [e.id, e]));
  const result: GroundedItem[] = [];
  for (const item of authored) {
    const refs = [...new Set(item.evidenceIds)].map(id => lookup.get(id)).filter((e): e is Evidence => Boolean(e))
      .sort((a, b) => a.startSeconds - b.startSeconds);
    const uniqueTimes = new Set(refs.map(e => Math.floor(e.startSeconds)));
    const specific = refs.filter(e => meaningful(e.note ?? ''));
    if (refs.length < 2 || uniqueTimes.size < 2 || specific.length !== refs.length) {
      result.push(item);
      continue;
    }
    const uniqueNotes = new Set(specific.map(e => signature(e.note ?? '')));
    if (uniqueNotes.size < 2) {
      result.push(item);
      continue;
    }
    refs.forEach((ref, index) => result.push({id:`${item.id}-segment-${index}`, title:'', text:clean(ref.note ?? ''), evidenceIds:[ref.id]}));
  }
  // Dedupe only exact repeated evidence/text combinations, never merge independent times.
  const unique = new Map<string, GroundedItem>();
  result.forEach(item => {
    const key = item.evidenceIds.slice().sort().join('|') + ':' + signature(item.text);
    if (!unique.has(key)) unique.set(key, item);
  });
  return order([...unique.values()], evidence);
}
