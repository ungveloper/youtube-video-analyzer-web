# v3.6 — Google 503 speech-clip recovery

## Observed failure
For a 202-second video, public Korean captions were unavailable. All three speech-only Gemini video clips returned HTTP 503 (`PROVIDER_BUSY`). The old `speechFocusedAnalysis()` discarded those upstream causes and surfaced `INVALID_RESULT` / "no speech obtained" after three calls.

## Fix
- Keep the default one-click three independent static-video requests and preserve clip-relative timestamps.
- When any clip fails **specifically** with `PROVIDER_BUSY`, retry *only the failed clip*, sequentially. Use the existing abort-aware 2.4s backoff (4.8s after a consecutive failed recovery). Stop after two consecutive failed 503 recoveries; never retry 429 or permission errors. Maximum total requests in this path: 6 speech clips plus an optional text-only compose request if some speech is recovered.
- Keep success results from other clips. Partial transcript + missing-coverage warning remains preferable to invented words, and a failed compose does not discard known utterances.
- If **no speech lines** are obtained, report the upstream failure class instead of hiding provider 503 under `INVALID_RESULT`. `INVALID_RESULT` remains appropriate when Gemini successfully returned an empty/invalid transcript with no upstream transport failure.
- The selected free model stays the same. No paid fallback, auto alternate-model switch, Redis, result persistence, fabricated audio or timestamp claims.

## Limits
A persistent Google HTTP 503 is an upstream availability problem and cannot be guaranteed away by client changes. A retry consumes additional free-tier requests and may still fail. Where Korean time-coded public captions are available, the existing captions-first path remains the least expensive and most grounded option.

## Validation
`node tests/speech-clip-recovery-regression.mjs`, existing regression suite, `npm run lint`, `npx tsc --noEmit`, `npm run build`. True video-provider behavior requires a real Gemini key and public-video test on the user's machine; mocked/static tests do not certify Google availability.
