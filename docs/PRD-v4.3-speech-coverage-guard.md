# v4.3 — Coverage-safe Korean YouTube transcript reconciliation

## User-observed regression
202-second video, after v4.2: 00:00–00:33 missing; 02:07–02:48 missing; last closing statement omitted. A long incomplete 01:37 clause and the repeated 01:41 suffix appeared as two different rows.

## Root-cause mitigations
1. Replace final fuzzy union-find/transitive clustering (A~B and B~C did not imply A~C). Every removal now requires a **direct** near-duplicate match against one retained item. Distant audio duplicates require independent review provenance and high text overlap. No artificial timestamp shifts.
2. Join a repeated **verbatim** suffix of an unfinished earlier sentence and prefix of its later continuation (not semantic paraphrases); preserve earliest model timestamp and the source wording. Cross-clip sentence merging requires literal overlap rather than temporal proximity alone.
3. Replace two hardcoded middle review requests with up to **three** short (~52 seconds maximum) *adaptive* reviews prioritized by observed missing start/interior/end windows; retain fail-fast 503, free-tier allowlist, 429 hard stop and shared time deadline. The model must actually hear the separate video clips; no script/website text is injected into production.
4. Keep previous final collage-quarantine and uncertainty disclosure for corroborated composite lines. Add per-request `analysis.speech_repair_plan` logs to know whether a missing region was scheduled, skipped or unsupported by source.

## Honest limitations
An absent first segment may be a Gemini upstream failure. Review calls can themselves fail or be skipped on time/429 budgets; an unverified Gemini timecode still isn't certified word alignment. This patch is not a substitute for actual independent timed ASR and audible ground truth. User-supplied third-party transcript and DOCX are *comparison fixtures*, never content to generate on arbitrary videos.

## Acceptance
Existing v4.2 sentence regression stays passing; new fixture proves four separate utterances at 0–33s survive, a distinct cart/stenosis paragraph around 2:08–2:48 survives, outro can survive, repeated 1:37/1:41 verbatim suffix merges into one complete sentence, and missing head/interior/tail get adaptive bounded review plans. Full npm lint, tsc, Next build and all existing .mjs tests required before commit or push.
