# v4.9 — Timed-caption-first speech timeline

## Root cause confirmed from LiveWiki public docs

LiveWiki publicly states that YouTube videos **must have caption tracks**, including auto-generated captions. Its script output therefore preserves YouTube time-coded subtitles and does not need to infer every word and timestamp from separate LLM video calls. The app previously logged `analysis.public_captions available:false` for a video that LiveWiki could caption: **failure of our extraction method is not proof that captions do not exist**.

## Change

1. Existing `fetchPublicKoreanCaptions` remains first.
2. On `null`, local server attempts `yt-dlp` with `--skip-download`, `--write-subs`, `--write-auto-subs`, Korean sub-langs and WebVTT output. It does **not** download video/audio, use cookies, call LiveWiki private APIs or require a Gemini token.
3. Parse into bounded, validated SRT cues. Preserve real YouTube caption cue timecodes; only collapse adjacent exact/contained rolling caption duplicates. Do not concatenate unrelated text or invent sentences.
4. `analyzeVideo` calls existing `deepAnalysis` with the retrieved captions to generate summary/article. After completion the timeline and transcript are **overridden from caption cues**, so the LLM cannot reorder/rewrite them.
5. If Gemini summary/article is rate limited (FREE_LIMIT/PROVIDER_BUSY/TIMEOUT), return a transparent **caption-only partial result** (empty summary/article, 28 captions where available); **do not claim a complete AI article**.
6. On missing binary / invalid caption / YouTube restriction, leave the pre-existing Gemini video-ASR fallback unchanged, including 429 aborts.

## Limitations

- Depends on `yt-dlp` installed and available in the **Next.js server process PATH**. On macOS: `brew install yt-dlp`.
- Accessing arbitrary YouTube captions can be blocked or throttled (IP, age, region, bot protection, unavailable captions). Different tools can succeed for the same video because of different network/auth setup. **Not guaranteed to reproduce LiveWiki for every video**.
- `yt-dlp` is an external maintained tool; updates may be necessary: `brew upgrade yt-dlp`.
- SRT timecodes are YouTube subtitle estimates, not certified word-level audio alignment. YouTube auto-subtitles may still contain recognition errors.
- For normal non-caption videos, the existing multiple Gemini video clip requests and rate limits remain unchanged. This patch does not solve those separately.

## Acceptance

- 202-second 28-cue user-supplied LiveWiki reference fixture must retain cue 20's 02:08–02:18 back-pain comparison, cue 25, and closing sentence.
- No video-specific utterance, site-specific LiveWiki scraping or hard-coded transcript appears in production.
- Caption-backed timeline retains actual cue text and timestamps after Gemini article generation, with `kind:'caption'` evidence.
- 429 on article generation yields caption-only partial result; 429 without captions continues to report error.
- Existing tests, ESLint, TypeScript and Next.js build must pass before commit/push.
