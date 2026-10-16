# v4.8 — Stop premature speech-echo timestamps without inventing speech

## Regression inputs (tests only)
- 00:19 long discussion of narrowing artery overlaps 00:30 shorter tail fragment.
- 02:15 erroneously early transcription of a 02:45 closing phrase, where a longer later independently returned phrase corroborates the wording.
- 02:41 full phrase has a mistaken 02:47 tiny trailing fragment.
- End signature appears twice with small variant; choose complete source.
- Keep unmatched 02:11–02:18 clauses as visibly incomplete rather than reconstructing words not returned by Gemini.

## Changes
- Add narrowly scoped distant-fragment echo detection for incomplete fragments whose common quoted content occurs in a materially longer later quote. Near-identical wording alone is insufficient if both phrases are complete or independently uttered far apart.
- Add local short trailing echo detection based on contiguous matching plus ordered character coverage.
- Do not re-time or change text in independent source lines. Keep existing quote-collage filtering and transcript pipeline unchanged.

## Non-goals
- No model call count changes; no web scraping; no hardcoded medical claims or source video text in production; no guarantee of missing-word recovery; no forced alignment of audio.

## Guardrails
- Repo version SHA check, clean git tree, old/new regression and lint/tsc/build, git push only after passing all.
