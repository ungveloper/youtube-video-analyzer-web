# v25.3 — Stateless SSE transport for basic Gemini video analysis

## Observed issue

Gemini 3.8 Flash video analysis sometimes exceeds the local 90-second deadline. A single full-video call can be slow even after v25.2 turned multi-clip and automatic 503 retry off. A previous standard call took 45 seconds; some later calls timed out. The upstream cause may include provider queueing.

## Changes

- Use Google Interactions `stream:true` for standard full-video or optional segmented basic analysis, with the same `store:false` and **one API request**. SSE `step.delta` chunks assemble the original structured JSON; completed status is mandatory. No browser/database caching.
- Keep the existing deep/compose/text-only calls in the old synchronous path to reduce regressions.
- Raise **streaming standard analysis hard budget** from 90 seconds to 120 seconds for short videos and 150 seconds for longer videos. 503 retry remains opt-in and shares one total deadline; no automatic model fallback or extra charges.
- Log `ai.stream_completed` including chunk count and time to first output, avoiding logging raw text.
- On a truncated or failed event stream, fail rather than using partial JSON / invented speech.

## Important limitations

- Streaming mitigates a long-held HTTP response, **not Google server overload, free 429 quota, or model transcription inaccuracy**.
- A request taking longer than the shared budget still times out, and SSE may not deliver its first text delta promptly.
- Background execution is intentionally NOT used: Google's Interactions API requires stored interaction state for `background:true`, which is incompatible with this app's `store:false` preference. Ref: https://ai.google.dev/gemini-api/docs/interactions-overview
- The app cannot claim accurate timestamps unless it has real time-coded audio/caption evidence.
