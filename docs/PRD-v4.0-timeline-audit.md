# v4.0 — Hide Next.js badge; bounded evidence-preserving speech/timing review

Date: 2026-10-14. Based on GitHub `ungveloper/youtube-video-analyzer-web` main after v3.9 harness recovery.

## Requirements

1. Hide Next.js development overlay bottom-left *indicator*, not actual build/runtime errors. Next.js 16.4 supports `devIndicators: false` in `next.config.ts`.
2. Preserve the six short overlapping static video clips, model allowlist, fallback only on 503/timeout, time budgets, 429 stop, and original sentence consolidation. Do not change non-speech routes or introduce billing.
3. The prior v3.9 review examined a gap >=19s at most once, often missing shorter 1-2-sentence omissions. Select the largest **interior** gap >=8s (after at least 12 initial lines), prefer the middle of the video, and cap the re-listen target to <=36s. If no interior gap, optional tail gap >=23s.
4. Add only genuinely new words from the reviewed target interval; reject repetitions and overlaps with existing utterances. No fabricated subtitles. Max ONE gap review, 42s deadline, subject to existing speech deadline and no quota error. **Silence is not proof of missing audio.**
5. Add at most ONE 24-second *real video* clock review after 1:00, subject to the same 205s speech deadline. It copies exact recognized sentence text but asks Gemini to listen and restamp offsets relative to that short clip. Apply a consistent 1.5–7s shift only if >=2 distinct verbatim matches corroborate it, and never if overlap, ordering, or window boundaries would break. Otherwise preserve all times and words.
6. Adjust speech extraction prompt so one line is a complete audible Korean sentence; no fragmenting a sentence across timeline rows.

## Boundaries / honesty

- Timestamps produced by Gemini, even after two independent listens, **are still estimates and are not guaranteed frame-/second-accurate forced alignments**.
- A missing sentence can only be restored if the model actually returns it when re-listening; a clear sentence may be too short to cause an 8-second gap and still be omitted.
- The optional extra free model calls can consume more free tier quota and time. No paid automatic fallback, DB, external ASR dependency, screen scraping, or silent fabrication.
- Existing source maps and sentence texts are kept; adjusted timestamps are propagated consistently to transcript, timeline, and source evidence.
- The Next.js indicator being hidden does not disable application error messages or Next.js errors.

## Validation

Guard exact code anchors, run the new pure logic tests, then *every* existing tests/*.mjs, lint, tsc, and Next.js production build. Only then commit and push. A real Google provider test is unavailable until run on the user's localhost with their own API key.
