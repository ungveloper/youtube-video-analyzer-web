# v19 — Timeline Time Integrity

## Problem

Video URL analysis attaches AI-produced evidence `startSeconds` to timeline rows. The prior validation only ensured `0 <= start <= end <= duration`. It did not compare spoken content to audio. The last displayed row might start at 02:34 on a 03:22 video, while a stale structural percentage was presented as if it measured completeness.

## Changes

1. `lib/timeline-accuracy.ts` provides a pure timestamp resolver and structural gap audit. The same resolver is used by displayed timeline rows, downloads, copy, and time audit. An adjusted row uses its manually provided start instead of changing other evidence.
2. URL-only timestamps are visibly identified as **AI-estimated / unverified**. User-provided timed captions preserve their supplied starts and are clearly attributed to that input. Neither is an independent audio verification.
3. Sequential anchors separated by more than `max(25 sec, 12% of video duration)` receive a *review hint*, not a false claim of missing spoken content. A sparse final anchor triggers a similar hint. All warnings are phrased as uncertainty, not transcript accuracy or factual validation.
4. Clicking **편집 → 시각 수정** prompts for `MM:SS` or `HH:MM:SS`, validates against video length, stores a per-timeline-row `timeOverrideSeconds` only in the in-memory edited copy, and triggers Sonner feedback. `원본 복원` removes the manual overrides.
5. Markdown, TXT, Word and PDF inherit edited starts; copied timeline includes `MM:SS`. No DB, Redis, browser persistence, model changes, additional AI calls, or automatic video downloads.
6. Structural observations are shown in the timeline panel rather than in the 'excluded facts' list. Actual generation failures stay visible. Server event `analysis.timeline_time_review` logs gaps and last visible start/end in seconds.

## Limits and safety

- This does **not** perform speech recognition or forced alignment. Without real timed transcript, true timestamps cannot be proven. No manufactured time anchors are generated.
- Gaps may be silence, a skipped section, or wrong AI timing. No automatic rearrangement or interpolation.
- The user's local recording permissions determine whether caption text may be supplied.
- Local Mac validation must run full regression tests, zero-warning ESLint and Next.js production build before Git commit/push.
