# YouTube AI Analyzer — 개인용 로컬 v2.0

> **현재 동작:** 브라우저 영구 저장과 최근 기록을 제거했습니다. 분석 결과는 현재 화면의 메모리에서만 편집할 수 있으며 페이지 이동·새로고침·탭 종료 시 사라집니다. **보관하려면 다운로드하거나 복사하세요.**

> **품질 개선:** 정밀 분석의 전체 문서 생성이 일시적 HTTP 오류·시간 초과·JSON 형식 오류로 실패하거나 아티클이 너무 짧으면 아티클만 한 번 더 요청합니다. 정상 2회, 오류 발생 시 최대 4회 무료 API 요청이 발생할 수 있습니다. 429 또는 권한 오류 시 추가 요청을 하지 않습니다. 원문 근거가 부족하면 글을 꾸며내지 않습니다.

- 설치 및 .env 설정은 `.env.example`의 `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, `GEMINI_FREE_TIER_CONFIRMED=true`를 참조하세요. **결제 미연결 Free Tier 프로젝트를 직접 확인**하세요. 이 설정은 과금 상태를 기술적으로 검증하거나 차단하지 않습니다.
- `npm run dev -- --hostname 127.0.0.1` 실행 후 영상 ID/URL을 입력하세요.
- Gemini API가 실제 공개 URL에서 근거를 추출할 수 있어야 정밀 아티클도 생성할 수 있습니다. 정확한 전사를 제공하지 못하는 경우 직접 보유한 SRT/VTT 입력을 선택할 수 있습니다.
- 로그인, Redis 및 별도 DB를 사용하지 않습니다. 서버는 로컬 개발에서만 분석 API를 허용합니다.
- 기존 버전에서 IndexedDB에 저장된 기록은 **자동 삭제하지 않습니다**. 브라우저 개발자 도구의 Storage/Application → IndexedDB → `youtube-video-analyzer`에서 직접 삭제할 수 있습니다.
- 편집, 원본 복원, Markdown·TXT·PDF·DOCX 다운로드 기능은 현재 화면에서 이용할 수 있습니다.
- Vercel 프로덕션에서는 분석 API가 기본적으로 차단됩니다.

변경 상세: `docs/PRD-v2.0-session-only-article-recovery.md`. 이전 버전의 상세 PRD는 `docs/`에 변경 이력으로 남아 있습니다.

## v2.1 — 원문 우선·빠른 분석·시간대 누락 점검

- **속도 우선:** 기본 영상 URL 분석은 1회 API 요청을 사용합니다. 정밀 URL 분석은 기본 2회이며 서버 오류 시 추가 요청이 발생할 수 있습니다.
- **원문 우선:** 이용 권한이 있는 SRT/VTT 또는 `0:00` 다음 줄에 발언을 적은 시간 지정 원문을 직접 붙여넣으면 **영상 URL을 AI에 보내지 않고 텍스트 기반 AI 요청 1회**로 상세 문서를 작성합니다. 이는 LiveWiki의 비공개 코드를 복제한 것이 아니라 공개 FAQ의 자막 기반 접근을 참고한 독립 구현입니다.
- **누락 식별:** 영상 후반부의 발언 근거가 없거나 타임라인 구간 수가 지나치게 적으면 부분 분석으로 분류합니다. 실제 내용을 자동으로 복구하거나 사실 정확도를 입증하는 것은 아닙니다.
- **비용 정책:** 기존 Gemini 무료 모델 허용 목록만 사용하며 과금 연결 상태를 자동 판별할 수 없습니다. Google AI Studio에서 결제 미연결 무료 프로젝트인지 직접 확인하세요. 저장·Redis·DB는 사용하지 않습니다.
- **빠른 품질 테스트:** `node tests/transcript-first-regression.mjs`로 원문 파서와 시간 분포 검사를 점검할 수 있습니다.

변경 상세: `docs/PRD-v2.1-transcript-first-speed.md`.

## v2.2 — 발언별 세밀한 타임라인

- 타임라인을 `00:00` 시각과 개별 발언/의미 전환의 순서로 표시합니다. 시각을 클릭하면 영상의 해당 위치로 이동합니다.
- **기본 분석:** 근거별 `note`가 실제로 제공된 구간만 더 작은 행으로 분리합니다.
- **정밀 분석:** 추출한 근거 `claim`이 있는 경우, AI가 하나로 합친 타임라인 문단을 원래 근거별 행으로 다시 나눕니다.
- **시간 지정 자막:** 짧은 구간과 문장 끝을 이용해 발언 단위로 나눕니다. 시간 정보를 추측해서 만들지 않습니다.
- Markdown·TXT·PDF·Word 출력에서도 `00:33` 형식의 시간 표시를 사용합니다.
- 별도 API 호출이나 영구 저장은 추가하지 않습니다. 이미 표시된 이전 결과는 갱신되지 않으므로 새 분석이 필요합니다.
- 상세 설계: `docs/PRD-v2.2-atomic-timeline.md`.


## v16 — Sonner 및 콘텐츠 보존

버튼 처리 성공/실패는 테마와 일치하는 Sonner 알림으로 표시합니다. 타임라인 세분화가 설명을 과도하게 줄이면 기존 원문을 보존합니다. 근거 종료 시점은 원문 검토 참고값일 뿐 실제 내용 확인률이 아닙니다. 추가 Gemini 호출은 없습니다. 세부 정책: `docs/PRD-v2.3-sonner-quality-guard.md`.


## v17 · 후반부 누락 방지 / Sonner 위치
- Sonner: 우측 하단, 동시에 최대 5개, 펼친 상태(`expand`)와 간격(`gap`)으로 토스트 겹침을 방지합니다.
- Gemini 3.8 Flash 영상 URL 요청은 공식 Interactions API에서 지원하는 `processing: agentic`를 사용해 원문/프레임 탐색을 시도하며, 동영상 입력 뒤에 질문을 배치합니다. Flash-Lite는 기존 기본 영상 처리 모드를 사용합니다. 에이전틱 처리는 품질·속도·API 안정성을 보장하지 않습니다.
- 기본 분석은 **영상 API 요청 1회**이며 초·중·후반 시간대별 발언을 점검하도록 요청합니다. 누락된 근거가 실제로 없으면 임의로 추가하지 않습니다.
- 명시적으로 선택한 정밀 분석은 1차 근거에 후반부 앵커가 없을 때에만 추가 **후반부 집중 영상 요청 1회**를 보내고 검증된 근거만 합친 후 문서를 작성합니다. 정상 2회, 후반 누락 또는 오류 복구 시 최대 5회까지 무료 할당량을 소모할 수 있습니다. Google 429/503이 반복되면 부분 결과로 남을 수 있습니다.
- 타임라인 분할 시 원래 설명을 보존하면서 누락된 근거 노트와 시간정보를 추가하며, 없는 타임스탬프를 생성하지 않습니다.
- `analysis.time_coverage`, `analysis.tail_scan`, `analysis.tail_scan_unavailable` 로그로 실제 근거 분포와 복구 여부를 확인할 수 있습니다.

## v18 · 5분 미만 Static 기본값 및 속도 진단

- 5분 미만 영상의 **자동** 처리 방식은 Google이 낮은 지연 시간에 권장하는 `static` 입니다. 5분 이상에서는 기존 3.8 Flash의 agentic 경로를 유지합니다. Flash-Lite의 자동 기본값도 그대로 static입니다.
- 분석 설정에서 `자동 / Static / Agentic`을 명시적으로 선택하여 같은 영상의 속도·품질을 비교할 수 있습니다. 영상 입력이 아닌 시간 지정 원문은 기존처럼 1회 텍스트 호출을 사용합니다.
- 기본 분석은 단일 AI 영상 요청을 사용합니다. Google 503/시간 초과가 발생해도 **자동으로 두 번째 긴 영상 요청을 보내지 않습니다**. 사용자가 재시도를 결정합니다. 정밀 분석의 429 중단 정책과 후반부 보완은 그대로 유지합니다.
- 기본 분석에 저지연 `thinking_level: low`를 지정하지만 모든 요약·타임라인·아티클·근거 검증 규칙은 유지합니다. 짧은 영상 기본 요청의 출력 토큰 상한은 12,000입니다(목표 길이가 아닌 상한).
- 구조화된 `ai.request_started`, `ai.request_completed`, `analysis.timing`, `analysis.failed` 로그로 요청별 모드·처리 시간·토큰 및 비디오 메타데이터/분석 총 시간을 확인할 수 있습니다. 사용자 화면에도 실제 AI 처리 시간을 표시합니다.
- 정확히 5초 완료를 보장하지 않습니다. Static이 빠를 수 있지만 실제 영상 후반부 내용이 누락되는지는 원본 대조가 필요합니다. 자막은 권한 있는 시간 지정 원문 직접 입력만 지원하며, 공개 YouTube 영상의 자동 자막을 공식 API로 언제나 확보할 수 있다고 주장하지 않습니다.

변경 상세: `docs/PRD-v2.5-static-speed-diagnostics.md`.

## v19 · 타임라인 시각 신뢰도 구분과 시간 정렬 점검

- 시간 지정 SRT/VTT·발언 원문을 사용한 결과는 **사용자가 제공한 자막의 시간 기준**으로 표시합니다. 자막과 실제 영상의 일치를 앱이 인증하는 것은 아닙니다.
- 영상 URL 분석에서 Gemini가 반환하는 초 단위 근거는 **AI 추정 시각**으로 명시합니다. 영상 길이 안에 있는 수치라는 이유만으로 실제 발언 시각이 맞다고 주장하지 않습니다.
- 타임라인에서 기준 영상 길이에 비해 큰 시간 공백과 후반부 시작 시각 부족을 알려줍니다. 공백이 실제 무음인지, Gemini 누락/시각 오류인지는 단정하지 않습니다.
- **편집 → 시각 수정**으로 영상을 듣고 확인한 시작 시각을 `MM:SS` 또는 `HH:MM:SS`로 입력할 수 있습니다. 사용자 수정 시각은 현재 화면, 복사, Markdown/TXT/PDF/Word 출력에 반영되며 브라우저 영구 저장은 없습니다.
- 기존의 `타임라인을 원본과 대조해주세요(마지막 ... 73%)`와 같은 구조적 시간 분포 경고는 **확인할 수 없어 제외한 내용** 목록에서 빼고 타임라인 자체의 대조 안내로 이동했습니다. 시간 수치는 실제 내용 확인률이 아닙니다.
- 처리 단계의 `analysis.timeline_time_review` 로그에는 실제 타임라인에 **표시된 앵커**의 시작/종료 초와 시간 공백을 기록합니다. 기존 무료 모델·영상 처리 모드·호출 수는 변경하지 않습니다.
- 자동 음성 재정렬/YouTube 공개 영상 자막 자동 다운로드는 구현되지 않았습니다. 입력 자체가 부정확한 AI 추정 시간이라면 원문 자막 제공이나 수동 대조가 필요합니다.

변경 상세: `docs/PRD-v2.6-timeline-time-integrity.md`.


## v20 — 발언 중심 타임라인·시간 지정 원문 보존

- **원문 우선 경로:** 사용자에게 사용 권한이 있는 SRT/VTT, 시간별 발언 또는 `[0:33] ...` 형식의 붙여넣기를 지원합니다. 타임라인은 자막의 실제 문장과 입력된 시작 시각을 서버에서 직접 구성하므로, AI가 아티클처럼 다시 쓰거나 내용/시간을 대체할 수 없습니다. 요약과 아티클은 AI가 따로 작성합니다.
- **영상 URL 전용 경로:** 타임라인이 해설문으로 바뀌지 않도록 Gemini에 발언 어순과 말투를 유지하도록 더 엄격하게 지시합니다. 그러나 음성을 실제로 검증한 전사가 아니므로 UI에서 AI 초안/추정 시각임을 명시합니다.
- **시간 끝 판정:** `02:48`에 마지막 문장이 시작해도 그 문장이 `03:18`에 끝날 수 있으므로, 마지막 시작만으로 영상 후반 누락을 단정하지 않습니다. 확인 가능한 근거 종료시각을 사용합니다. 시작만 제공된 텍스트의 마지막 발언 종료시각은 영상 끝으로 자동 연장하지 않습니다.
- Gemini 호출 수 증가, 새 DB/브라우저 저장, 유료 API 전환은 없습니다. 세부사항: `docs/PRD-v2.7-verbatim-timed-timeline.md`.


## v21 — Google 503 안정성 및 중복 알림 방지

- Gemini HTTP 503은 `PROVIDER_BUSY`로 별도 분류하고 긴 Google 원문 오류 대신 짧은 한국어 안내를 보여줍니다. API 키·정책 오류와 혼동하지 않습니다.
- 사용자가 켤 수 있는 **503 재시도 1회**(기본 활성)를 제공합니다. 기본 분석·정밀 영상 근거 추출에서 2.4초 대기 후 동일 무료 모델로 딱 한 번 재요청하며, 설정을 끄면 503 즉시 실패합니다. 추가 요청은 무료 할당량을 사용할 수 있습니다.
- **HTTP 429는 무조건 즉시 중단**, 결제·유료 모델 자동 전환·자동 다른 모델 선택 없음. 반복된 503에서는 결과를 보장하지 않습니다.
- 분석 진행 상황은 화면 진행 패널에서만 보여주고, 최종 오류의 상세 내용은 화면 경고 패널 한 곳에서만 표시합니다. 같은 오류를 Sonner 토스트와 상태문구로 중복 출력하지 않습니다. 분석 성공·편집·복사·다운로드는 기존 다크 테마 Sonner를 유지합니다.
- 진단 로그: `analysis.standard_503_retry`, `analysis.source_retry_scheduled`, `ai.http_error`. 상세 설계: `docs/PRD-v2.8-provider-busy-single-alert.md`.


## v22 · 발언 우선 타임라인과 누락 구간 선택 보완

- URL 분석 결과에서 Gemini가 제공한 `transcript` 발언 문장이 있으면 **그 텍스트를 그대로** 타임라인으로 사용합니다. 별도 AI 편집 요약문으로 대체하지 않습니다.
- 스크립트 발언의 중간·끝부분에 긴 공백이 있으면 **명시적으로 선택된 경우에만** 해당 시간 구간의 음성을 한 번 더 확인합니다(기본 체크됨). 추가 무료 영상 API 요청 최대 1회입니다. 503/429 발생 시 이미 확보한 발언을 잃지 않고 부분 결과로 남깁니다.
- transcript가 없으면 기존 근거 요약을 사용할 수 있으나 이는 녹취록이 아님을 안내합니다. 누락된 음성을 지어내거나 타임스탬프를 분배하지 않습니다.
- AI가 생성한 발언과 초 단위 시각은 **여전히 검증되지 않은 추정**이며 실제 자막 또는 음성 강제 정렬을 대신할 수 없습니다.
- 기존 Sonner 우측 하단 최대 5개, 오류 단일 표시, 무료 모델 제한, 세션 전용 결과 저장 방식 유지.


## v23 · 잘못된 시간 코드 차단 / 라이브 개발 서버 중 패치

- v22 보완 응답이 요청하지 않은 시간(예: 마지막 발언을 00:02로 반환)을 섞어도 타임라인에 합치지 않습니다. 응답은 **선택된 보완 구간 한 곳** 안의 절대 시각인지 검사합니다.
- 내용이 동일한 발언을 시간이 다르게 반환하면 중복 추가하지 않습니다. 기존 발언과 겹치거나 1초에 긴 문단이 몰린 것처럼 명백히 의심스러운 시간 정보도 폐기합니다.
- 후반 발언을 확보하지 못한 경우에는 전체 완료를 꾸미지 않고 부분 분석 상태를 유지합니다. URL에서 추출한 발언 시각은 여전히 AI 추정으로, 실제 음성과 대조되지 않은 값입니다.
- 코드 적용 스크립트는 **포트 3000 서버 때문에 중단하지 않습니다**. 개발 서버가 실행 중이면 `npm ci`를 건너뛰고, 프로덕션 빌드는 별도의 임시 폴더에서 실행해 현재 `.next/dev` 캐시와 `node_modules`를 건드리지 않습니다. 빌드/테스트 실패 시 Git 푸시하지 않습니다.
- 제한: Google이 원본 후반부를 정확하게 전사하지 못하면 코드만으로 해당 발화를 자동 완성하거나 초 단위 시각을 보장할 수 없습니다.


## v24 · 공개 자막 우선 / 429 절약

- URL 기본 분석은 공개 한국어 YouTube 시간 지정 자막을 짧게 조회합니다. 충분한 자막이 확보되면 음성을 재추측하지 않고 원문 시각·문장으로 타임라인을 만들며, 요약·아티클은 무료 Gemini **텍스트 요청 1회**로 작성합니다. 자막 출처는 '공개 YouTube 자막'으로 구별합니다.
- `01:58 / 03:22`처럼 자막이 너무 일찍 끝나거나 중간에 긴 공백이 있으면 전체 자막으로 수용하지 않습니다. 자막을 찾을 수 없으면 기존 비디오 URL 분석으로 돌아가며 **시간 정확도를 보장하지 않습니다.**
- 기존 speech-tail 요청은 429로 실패할 수 있어 **기본 비활성화**했습니다. 선택적으로 켜면 Static의 공식 `start_offset`/`end_offset`을 사용해 시간 범위를 제한한 요청 1회를 추가합니다.
- 개발 서버가 포트 3000에서 동작 중이어도 격리 테스트·빌드를 실행하는 적용 스크립트입니다. 자세한 내용은 `docs/PRD-v3.1-public-captions-first.md`를 참조하세요.


### v25 · Short Static segmented speech (experimental)

- With the experimental short-segment option enabled (default; switch off to restore prior whole-video request), on a 120–300 second video without usable public time-coded captions, **standard Static** analysis sends three non-overlapping, explicitly clipped video segments in **one Gemini interaction** (single request, not 3 requests). The Interactions API's `start_offset` and `end_offset` are seconds strings such as `67s`, not JavaScript numbers.
- The response contains `segmentTranscripts`: local-time utterances for segment indexes 0, 1, and 2. Code offsets each line into the original video timeline and rejects timestamps outside their segment, duplicate utterances, implausible compressed sentences and overlaps. It never treats global-time guesses from a separate transcript as a fallback when segmented input was used.
- Logs include `analysis.segmented_speech` (`clips`, `includedSegments`, `missingSegments`, `lines`, `rejected`, `lastEnd`). `analysis.time_coverage` logs separate `missingEvidenceWindows` and `missingSpeechWindows`. Neither proves exact audio alignment.
- This is **not** authenticated ASR or forced alignment. Gemini may still return incorrect language or miss speech, and multiple video segments in one interaction may have different latency/limits. Public timed captions, if available, remain preferred; user-supplied SRT/VTT remain authoritative. Agentic and longer videos keep prior behavior.
- No additional default Gemini request, model fallback, paid service, persistent store, or dependency. The optional 503 retry and optional speech-recovery request remain separate settings.

## v25.2 — Timeout Guard (2026-10-13)

- `gemini-3.8-flash`의 202초 영상에서 실험적인 3클립 입력이 95초/126초 연속 TIMEOUT 된 운영 로그를 바탕으로 **3구간 분석 기본값을 OFF**로 전환했습니다. 옵션은 그대로 유지되지만 수동으로만 실행합니다.
- Google 503 재시도도 **기본 OFF**로 변경했습니다. 무료 등급에서 불필요하게 2번씩 호출하거나 90초씩 새로 기다리지 않도록 기본 분석의 **전체 90초(5분 미만)** 또는 **120초(그 이상)** 시간을 동일한 예산으로 공유합니다.
- 사용자가 503 재시도를 켜더라도 재시도 대기 2.4초 이후 15초 미만이 남으면 추가 호출하지 않습니다. 429와 TIMEOUT 자동 재시도는 없습니다.
- `analysis.provider_timeout`과 `analysis.standard_503_retry_skipped` 로그로 제한 시간과 재시도 건너뜀을 구분합니다.
- 이것은 **타임아웃·중복 API 소모를 줄이는 안정성 변경**이지 정확한 축자 녹취를 만드는 패치가 아닙니다. 자막을 확보하지 못하면 영상의 1분 이후 시간 밀림 또는 마지막 발언 누락이 발생할 수 있습니다. 시간 지정 SRT/VTT가 있으면 우선 사용하세요.
- 문서: `docs/PRD-v3.3-timeout-guard.md`.


### v25.3: 기본 분석 Gemini SSE (비저장 방식)
- 기본 영상 분석은 Google Interactions `stream:true`와 `store:false`를 함께 사용합니다. 완전한 응답만 유효한 결과로 취급합니다.
- 짧은 영상의 통합 요청 제한시간은 최대 120초(긴 영상 150초)이며, Google 제공자가 장시간 응답하지 않으면 TIMEOUT이 여전히 발생할 수 있습니다.
- 전체 결과를 하나의 스트리밍 요청으로 받으며, 별도 유료 모델/재분석/백그라운드 저장이 없습니다.
- `ai.stream_completed` 로그에서 출력 청크 수와 첫 출력까지 걸린 시간을 확인할 수 있습니다.


## v26 — URL 입력 즉시 발언 구간별 분석

- 메인에서 URL을 입력하고 **분석 시작**을 누르면 영상 정보 확인 후 바로 분석합니다(별도 분석 깊이 선택 없음). URL `?start=1`은 분석 준비가 완료된 경우에만 1회 소비하며 제거합니다.
- 공개 시간 지정 자막을 얻지 못한 **2~5분 Static 영상**은 3개 실제 구간을 각각 Gemini에게 전달해 발언 텍스트만 추출합니다. 각 클립의 상대 시각은 코드에서 원본 시각으로 변환하며, 마지막 구간을 먼저 확인합니다. 다른 발언을 만들어 공백을 채우지 않습니다.
- 발언 추출은 최대 3회, 요약·아티클 작성은 최대 1회, 총 **무료 API 호출 최대 4회**입니다(실패·429 시 일부 호출을 생략). 자동 유료 전환, 저장소, 데이터베이스, 503 무제한 재시도는 없습니다. 무료 일일 호출량이 빠르게 소모될 수 있습니다.
- Gemini가 반환한 발언과 시각은 **검증된 음성 전사·강제 정렬 결과가 아닙니다**. 후반부 발언 확보에 실패한 구간은 실제 시각대로 `MM:SS~MM:SS`로 표시하고 **부분 분석**으로 표시합니다.
- 5분을 초과하거나 Agentic으로 선택한 영상은 기존 분석 경로를 유지합니다.

상세: `docs/PRD-v3.5-one-click-independent-speech.md`.
