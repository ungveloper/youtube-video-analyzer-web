# v4.2 — Independent speech reconciliation without collage

Observed on a 202-second Korean YouTube video: the restored 01:46–02:36 paragraphs were now present, but independent 34–42-second clip and follow-up coverage transcription results overlapped. Short fragments were repeated as separate lines, and some generated lines concatenated phrases heard ~20 seconds apart.

Changes:
- Keep 6 source clip calls, provider fail-fast/fallback, 2 middle reviews and 429 guard unchanged.
- AFTER audio reviews and before constructing the evidence timeline, run deterministic reconciliation on *actually returned* lines.
- Prefer longer complete original utterances over duplicated shorter fragments; a corroborating review may supply a more trustworthy complete version.
- Detect obvious suspect collages **only** when one entry contains two long independent verbatim subphrases also present in separately timestamped rows >=16 seconds apart. Quarantine the collage, do not split/re-time or invent replacement words. Other independent entries remain.
- Preserve genuinely different sentences even if provider estimated overlapping timestamps; log unresolved time overlap rather than invent seconds.
- Keep repeated identical speech when occurrences are far apart, as videos legitimately repeat conclusions.
- Expose reconciliation counts and warn about quarantined content / timestamp collisions. No site-specific transcript, video ID, disease terminology, or external scraping in production code.

Limitations: a model-generated collage without cross-corroborating nearby rows cannot be reliably detected; no deterministic text reconciliation guarantees forced audio word alignment. The user-supplied SaveFrom excerpt and the longer recorded-source Word script are quality reference fixtures, not proof of exact edit timestamps.

Acceptance: source fixtures include the shortened '간헐적 파행이에요', '아파서 쉬어야 되고요', duplicated closing clause, and mixed-speech paragraph; all must be handled while preserving the original vascular-disease comparison and shopping-cart example. On-device full regression, lint, tsc, build required prior to Git commit/push.
