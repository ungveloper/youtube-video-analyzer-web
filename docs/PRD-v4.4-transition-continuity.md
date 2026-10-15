# v4.4 — Short transition continuity review

## Regression being addressed

A 202-second edited Korean medical video now produces a largely complete timeline. One short introduction at roughly 02:08–02:15 is missing. The next captured sentence begins with a sequencing cue ("그다음에"), yet the estimated timestamps do not show a >=9-second gap. The existing v4.3 repair planner therefore may leave this omission unreviewed even though the surrounding conversation is available.

## Minimal intervention

- Only change the time-window planner in `lib/speech-coverage-recovery.ts`. Do not modify six clip processing, spoken text merger, deduplication, server pipeline, normal result schema, UI, model ID, provider failure or API quota guards.
- If a non-initial mid-video utterance begins with a generic Korean sequencing/contrast cue and follows the previous utterance within a small plausible interval, plan ONE 28-second video re-listen centered on the utterance. It gives the provider ~14 seconds of preceding audio to catch a lost counterpart, and ~14 seconds after for context.
- Only schedule that audio re-listen if budget remains under the existing three-extra-request maximum. Preserve the existing broader middle reviews; broad and focused windows are not near-identical even if one is nested inside another.
- The audio re-listen follows the existing independently sourced extraction and time-aware deduplication. No disease-specific terms, fixed video ID, user-provided transcript text, synthetic evidence or forced timestamp are added to production.
- Keep 429 hard-stop, deadline checks and no paid model fallback as-is. If Google returns no omitted speech, leave the timeline unchanged, not invented.

## Testing

1. A no-gap timeline without sequencing cues must retain the old two middle windows.
2. A model-estimated 02:09–02:15 transition with "그다음에" receives a focused 02:01–02:29 review plus both original broad middle reviews, <=3 extra calls total.
3. Independently heard missing sentences are eligible to join the transcript; old head/tail lines persist and no text is hardcoded.
4. Run all existing regression `.mjs`, lint, TypeScript, Next build on macOS before git commit/push.

## Limits

A word prefix is a signal to listen again, not proof content was omitted. The provider may still miss speech, the extra call might be skipped by the existing time/quota limits, and second-pass Gemini timestamps remain estimates, not forced alignment.
