# v4.5 — Severe interior speech gaps (2026-10-15)

Observed: on the same 202-second Korean video, a previously high-quality result suddenly omitted all speech between ~01:35 and 02:48 (~73 seconds) in v4.4. This indicates provider / transcription variability, not a proven specific deletion stage. It is unsafe to claim the missing sentences were extracted when no source speech lines exist.

## Changes

- Keep existing six short clip requests, fail-fast 503 handling, free-tier policy, final reconciliation, and all validated content intact.
- A missing **interior** interval >=54s is split into 2–3 genuinely overlapping static video reviews, each <=52s. The former single centered 52s clip left the edges of a 73s gap unaudited.
- For the first pair covering the same severe gap, issue two independent Gemini requests concurrently (maximum two in flight); process and merge their results **serially**. No parallel mutation of transcript state.
- Continue to stop further review on 429 (`FREE_LIMIT`), retain bounded wall-clock deadlines, and avoid invented text. Failed or empty audio reviews cannot be treated as coverage.
- When an interior gap >=35s survives all attempts, emit `analysis.speech_severe_gap_unresolved` and an explicit **심각한 발언 누락** message in exclusions. Keep the known transcript and mark result partial; never silently present an incomplete timeline as verified.
- Never embed the user's transcript or medical vocabulary in production logic. Source timestamps are estimates and the script may still need authentic subtitle/ASR evidence for reliable full coverage.

## Acceptance

1. For a synthetic 202s transcript with speech to 95s and starting again at 168s, the recovery plan contains two bounded clips whose union covers the whole 73s hole, with overlap; no >52s provider clip.
2. A normal dense transcript preserves the old two-middle-review plan.
3. Merge four legitimately returned mid-video utterances, with no deletion of beginning/end anchors.
4. No review calls beyond the budget or after quota failures. Severe remaining gaps are unmistakably disclosed.
5. Entire `.mjs` suite, ESLint, `tsc --noEmit`, Next.js build pass before committing/pushing.

Live Gemini reliability and actual 73s recovery remain to be verified by running the affected video locally; static regression tests cannot certify provider hearing quality.
