# v25.2 — Analysis Timeout Guard

## Observed regression

Two consecutive Gemini 3.8 Flash three-clipped STATIC runs for a 202-second YouTube video failed: one Google 503 after ~32s followed by a retry ending at 126s; another attempt timed out after ~95s. The prior default enabled both experimental multi-clip input and one fresh 90-second provider retry.

## Safety defaults

- Default to a **single full-video STATIC input** (short three-clip experimental option remains available but disabled).
- Default Google 503 retry **off**; allow opt-in only. No retry for HTTP 429, timeout, or provider-invalid request.
- Basic standard analysis shares one **90s total Gemini request deadline** for videos under 5 minutes (120s for longer videos) across both attempts, rather than allocating 90s to each. Retry only if >=15s remain **after** the 2.4s cooldown.
- A timed-out standard request logs `analysis.provider_timeout`, identifying model, standard/standard-segmented pass, attempt, and total elapsed time. No extra API requests for diagnostics.
- Existing speaker wording preservation, 503 single inline error, timestamp review, and optional speech recovery remain.

## Critical limitations

Disabling experimental clips restores the previously faster full-video request, **not accurate speech-to-text**. Where public caption retrieval returns `available:false`, Gemini can omit the final minute or shift timestamps. Do not mislabel an incomplete 202s video as fully transcribed. No paid API or automatic fallback is introduced.
