# v3.8 — Short contextual audio clips for speech timeline alignment

## Why
202s video transcriptions were close in wording but estimated absolute time became unreliable after minute 1; two short utterances were also missing. Prior one-click fallback processed 3 separate 67s static clips, each local time estimated by Gemini. Offsets were correctly added by code, but clip-internal timing was not grounded by external time-coded captions.

## Approach
- For the automatic speech-first 120–300s STATIC path only, create six clips on a 202s video with non-overlapping **utterance-start ownership** and 4s listening context on either side. The exact 202s clips are `[0,38]`, `[30,71]`, `[63,105]`, `[97,139]`, `[131,172]`, `[164,202]`; cores are `[0,34]`, `[34,67]`, `[67,101]`, `[101,135]`, `[135,168]`, `[168,202]`.
- Process the final clip as service-health probe; if HTTP 503 or timeout, probe the other allowlisted free model ONCE. Stop immediately if both fail, never switch to paid models or retry a 429.
- Once probe succeeds, process remaining clips **at most two at a time**, and keep a shared max 205s clip deadline and 265s overall document deadline. Skip remaining work safely when near deadline and preserve already obtained speech.
- Prompt the model to retain all audible questions/connectives and transcribe only utterances that **start** inside the owned core. Translate clip-relative timing by code. Reject any utterance that starts in the extra contextual padding, is outside the clip, overlaps existing speech, duplicates another utterance, or has impossible word density. Mark unresolved time intervals instead of inventing contents.
- Existing manual/deep/three-clip paths stay unchanged. Source/timeline evidence remains labeled as unverified AI estimates; a real audio alignment model or verified timed captions are still necessary for ground-truth seconds.

## Cost and operational tradeoffs
An ordinary 202s URL video with no captions now uses **6 video calls plus up to 1 text composition call**, versus 3+1 previously. The 503 free-model fallback could add 1 probe call, and a 429 stops additional batches. Slightly longer latencies and greater free-tier quota use are intentional accuracy tradeoffs. No persistence, API keys, payment permissions or dependencies are added.

## Validation
`tests/precision-speech-regression.mjs` asserts precise segment offsets, clip ownership, boundary filtering and no fabricated timing. `tests/short-video-failfast-regression.mjs` verifies provider outage, fallback, partial result and batching. Run all regression tests, ESLint, TypeScript and Next production build before Git commit/push.
