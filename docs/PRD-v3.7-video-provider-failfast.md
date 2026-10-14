# v3.7 — Remove redundant UI panels; fail-fast free Gemini recovery

## Reported failure
On 2026-10-14 a 202-second public YouTube URL had no accessible public Korean captions; three STATIC speech clips failed with HTTP 503/timeout. The previous v3.6 policy retried two failed clips, consuming five video calls and taking ~207s with no transcript.

## Changes
- Remove the two user-requested UI notices **only**: the `원클릭 무료 Gemini 자동 분석` panel and the `중요 안내` card. Preserve the actual analysis-status error alert, manual retry control, and per-result quality warnings.
- For a 120–300s no-captions static video, first request just the last clip from the selected free model (a real video input, not a text-only health check).
- If and only if that request returns `PROVIDER_BUSY` or `TIMEOUT`, after 1.6s use **one** alternate model from the existing `FREE_MODELS` allowlist, with a 45s timeout. Show the model switch in progress, logs, result model and exclusions. No fallback on 429, credential/permission errors or arbitrary response errors. Do **not** switch to a paid model.
- When both models cannot process the probe, stop immediately; don't launch the remaining two clips or a composition request. Maximum video requests on an initial persistent 503 failure: **2**, instead of 5.
- After a successful first probe, request two remaining independent clips with 65s per-request timeouts; preserve per-window and clip-relative timestamp validation. Compose text separately, using the actual free model that succeeded. Only retain a verified-by-output transcript; do not manufacture utterances or infer silence.
- An entirely empty successful response is `INVALID_RESULT`, not a provider 503; if subsequent clips produce speech, keep a partial result and disclose missing intervals.

## Limitations
This avoids futile duplicate calls; it **cannot repair a Google-wide outage or a failure to ingest the specific YouTube URL**. A secondary free model may still return 503/timeout or yield less accurate speech, and a working clip does not establish complete coverage. No live Google API test can be run without the user's local key. Users should compare timecodes to original video.

## Validation
All `.mjs` regression tests, ESLint, TypeScript and Next.js build must pass before commit / push. No dependencies, backend storage or API key changes.
