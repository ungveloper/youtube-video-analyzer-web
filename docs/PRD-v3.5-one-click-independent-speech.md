# v26 — One-click independent speech clips

## Problem
Combined video transcription, timeline, editorial composition and article generation often omitted a middle 50-second interval and everything after ~02:39 in the 03:22 reference video. Combined 3-clip requests timed out, while prompt-only follow-up stamped late speech near 00:02. Public Korean captions returned unavailable. No ground-truth subtitles are available.

## Change
- Home form navigates to `/analyze/[videoId]?start=1`; client starts once after metadata and quota readiness. No 1x/deep selector.
- For short 120–300s Static videos without public captions, request **three independent speech-only clips**, starting with the final third, with at most two in flight. The Gemini output must use clip-relative seconds. Code validates and shifts each line by the known clip offset. The existing transcript-to-timeline bridge preserves utterance text; editorial composition is separate and cannot rewrite it.
- Each clip uses a small speech JSON schema and low thinking budget. Composition uses the speech-only source ledger. `store:false` is maintained.
- Track failed/empty clips and speech gaps, report them as MM:SS spans without inventing missing words or silence. If composition fails, keep a partial transcript only; if no speech lines are obtained, show an explicit failure.
- No paid model fallback, no Redis/DB, no local persistence, no 429 retry. Worst case 4 Free Tier requests for a short video, so quota usage is a conscious tradeoff for improved segment coverage.
- This is NOT a guaranteed accurate or exhaustive transcription system. Time-coded original captions or an independent speech-to-text/forced-alignment engine are required to verify timestamps.

## Validation
`tests/independent-speech-clips-regression.mjs` asserts 00:00/01:xx/03:xx clip offsets, missing last clip, no STATIC display_name, deterministic evidence and one-click startup. Run all existing tests, ESLint and Next.js build in isolated workspace on the user's Mac before publishing.
