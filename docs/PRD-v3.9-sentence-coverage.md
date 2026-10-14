# v3.9 — Sentence integrity & long-gap recovery

- Retain v3.8 six-window precision and free-model HTTP 503 fail-fast.
- Require a completed utterance per Gemini line rather than arbitrary 2–3-second fragments.
- Deterministically join only nearby unfinished utterances. Timestamp stays the first real start; no invented words.
- For a substantial >19s transcript gap, make one bounded additional static video listen, only if source speech exists and deadline/429 policy permits. Preserve the original transcript if the extra request fails.
- Restore strict core ownership (0.5s tolerance). Overlap is listening context only; it must never preempt the next core’s utterance.
- A successful model result is not a certified audio alignment. Manually verify timecodes and factual content; no fake timestamps or guaranteed 100% transcription.
