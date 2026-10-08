# v1.6 · Evidence-first Pipeline / Free-tier model comparison

## Purpose

Avoid rerendering a short draft twice and selecting the longer one. Deep analysis is a source-extraction step followed by text-only grounded composition. Do not invent content, timestamps, or transcripts to reach length targets.

## Selected models

- `gemini-3.8-flash` (default selection in local UI)
- `gemini-3.5-flash-lite` (baseline comparison)
- Both appear with a Standard Free Tier in the official Google AI pricing documentation as of 2026-10-08. Access, rate limits, terms and billing linkage depend on the key's project and may change.
- Never accept arbitrary model names or automatically fall back to paid providers.

## Deep execution

1. Provider call 1 includes the public YouTube URL and schema-constrained source map: `evidence`, `claims` (with source `evidenceIds`), optional accurate `transcript`, `exclusions`.
2. Verify time bounds, evidence IDs, claim references. If no grounded claims are obtained, stop honestly.
3. Provider call 2 receives *text only*: the first-stage source map. It must reference existing claim IDs and their evidence IDs, and produce summary, timeline and article. It may not introduce new claims. A failure here results in explicitly labeled claim-based fallback, not fake detailed content.
4. Validate the generated reference structure again, then send to the client and save to IndexedDB. Semantically false claims are still possible and should be checked against the actual video.

## Standard execution

Single pass using the previously implemented JSON format. Retries apply only to transient errors. Deep mode performs exactly two intended calls without an unbounded retry loop.

## Security and operations

- Only localhost development mode; no Redis, login, database, or remote server result storage.
- Local `GEMINI_FREE_TIER_CONFIRMED=true` is a manual flag, not billing verification.
- User chooses a model and analysis depth explicitly. Display actual model, provider calls and whether composition succeeded.
- Provider errors, quota exhaustion and timeouts cannot trigger paid fallback.
- Source-map output is not a verified transcript: video/audio provenance is an AI claim and must be compared to YouTube. Timestamp range validation is not semantic validation.
- On client interruption, partial results can be lost. User browser storage remains best-effort.
