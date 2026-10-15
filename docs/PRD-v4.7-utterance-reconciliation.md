# v4.7 — Korean speech reconciliation / repeat guard

## Observed issue

A 202-second Korean YouTube speech extraction independently returned similar fragments from six clips and re-listens. It repeated the conclusion opener near 02:38/02:47/02:48 and the doctor's closing statement near 03:02/03:08. Some incomplete list introductions were adjacent to unrelated contrast statements; joining them creates false content. One young/old patient comparison remained incomplete in the provider response.

## Scope

Surgically edit only `lib/speech-finalize.ts` and `lib/speech-sentence-merge.ts`; preserve six video clips, independent audio reviews, quota handling, time windows and summarization from v4.6.

- Unify close-in fragments whose **ordered character sequence** agrees despite small Korean ASR spelling variants; retain the longer, more complete quotation and its own returned timestamp.
- Require a common lead-in anchor or near-exact suffix for fuzzy deduplication; medically different statements with a shared template (e.g. disease A vs disease B) must remain separate.
- Protect genuine repeated speech far apart in time.
- Do not let earlier incomplete quote copy its timestamp onto a later complete quote.
- Do not glue a clause starting with a contrast/transition marker onto an unfinished preceding list.
- Keep `suspiciousCollage()` handling, absence-of-source fabrication safeguards, existing large-gap handling and source evidence rules.
- No production text contains video-specific medical facts, transcript fixtures, or guessed missing sentences.

## Validation

`tests/speech-v47-real-utterance-regression.mjs` checks the reported overlapping intro and closing, incomplete disc / contrast context, unrelated vascular-vs-spinal phrases, earlier timestamp protection, and genuine repeated speech. Existing v4.2/v4.3 sentence and deduplication regressions must continue to pass. Install script runs full `tests/*.mjs`, lint, TypeScript and build **before** commit/push.

## Known limits

Fuzzy text matching cannot certify exact audio timing or guarantee that the Gemini source transcript contains every spoken sentence. The external SaveFrom timed excerpt is a case fixture, **not** a production source or an authenticated alignment. A missing phrase (e.g. an omitted older-patient sentence) cannot be invented; use genuine subtitles or original audio-based ASR to establish it. A 429 quota rejection is a provider limit, not a text reconciliation bug.
