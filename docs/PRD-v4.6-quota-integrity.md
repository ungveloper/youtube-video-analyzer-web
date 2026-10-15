# v4.6 — Quota safety and honest completion semantics

Incident: During a 202-second transcription, late clip 5 succeeded (~22.5 seconds), then requests for clips 0 and 1 returned Google HTTP 429 / `FREE_LIMIT`. No more speech clips or article request ran. Previous code still emitted a completed SSE analysis containing just seven utterances from the final 34 seconds, producing an apparent regression in speech quality.

## Change
- An HTTP 429 from **any primary** speech clip immediately fails the entire analysis before assembling partial lines. One late successful probe is never represented as the complete video.
- A 429 from optional audio relisten or article composition also raises `FREE_LIMIT` instead of quietly presenting an article-free output as a finished analysis.
- If at least one primary clip failed and a >=45-second unchecked interval remains even after reviews, fail with `SPEECH_INCOMPLETE` instead of falsely reporting success.
- Keep the existing six core windows, v4.3–v4.5 utterance preservation, gap reviews, deterministic finalization, free-only model allowlist, and fail-fast/free fallback policy unchanged on successful requests.
- Avoid emitting incomplete transcript or article content on failure. The existing SSE handler sends a `failed` event with an explicit code and message.

## Limits
HTTP 429 is a Google quota/rate response, not an ASR algorithm error. Software cannot bypass it; wait for the provider limit to clear, check the active free-tier quota, or use user-provided timed captions. The exact reset time is unknown. SSE routes may still return HTTP 200 as the stream transport while conveying the actual failure in the `failed` event. No automatic paid model conversion or retry loop is permitted.

## Verification
Regression covers successful late probe followed by 429, five middle clip failures after late success, 429 fail-fast and no composition, plus no paid fallback. Full test suite, lint, TypeScript check and Next.js build must pass on the local Mac before git commit and push.
