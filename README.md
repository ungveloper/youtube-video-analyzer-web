# YouTube AI Analyzer · 개인용 무료 등급 PoC v1.6

이 저장소는 PRD v1.0 기반 Next.js 16 App Router / React 19 / TypeScript / Tailwind CSS 개인 테스트 앱입니다.

## 무엇이 바뀌었나요?

- Redis, DB, 로그인, 익명 쿠키 및 서버 측 하루 3회 분석 제한을 **완전히 제거**했습니다.
- Gemini Interactions API의 공개 YouTube URL 미리보기 입력을 사용합니다. 무료 모델 `gemini-3.8-flash`와 `gemini-3.5-flash-lite` 중 직접 선택할 수 있습니다. 정밀 분석은 근거 추출·상세 작성 2단계로 처리합니다.
- **결제 미연결 Free Tier 프로젝트**의 키만 사용하도록 운영자가 직접 확인하고 승인해야 합니다. 모델의 무료 사용 가능성과 계정의 결제 상태는 서로 다릅니다.
- AI 분석 API와 YouTube 조회 API는 `next dev`의 `localhost` 요청에서만 동작합니다. 프로덕션에서는 분석이 자동 비활성화됩니다.
- 결과는 기존 IndexedDB에 저장하며 수정·원본 복원·복사·MD/TXT/PDF/DOCX 내보내기를 그대로 지원합니다.
- 무료 API 한도 소진(HTTP 429) 시 재시도하거나 유료 모델로 자동 전환하지 않습니다.

## 꼭 필요한 3개 설정

1. [Google Cloud](https://console.cloud.google.com/)에서 YouTube Data API v3를 활성화하고 `YOUTUBE_API_KEY`를 받습니다. (기존 키가 있다면 계속 사용 가능.) 영상 길이(최대 30분) 검증에 사용합니다.
2. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 **Cloud Billing이 연결되지 않은 무료 등급 프로젝트**로 Gemini API 키를 생성합니다. `GEMINI_API_KEY`에 넣습니다. 결제가 연결된 다른 프로젝트 키를 복사하지 마세요.
3. Google AI Studio에서 해당 프로젝트가 Free Tier임을 직접 재확인한 뒤 `GEMINI_FREE_TIER_CONFIRMED=true`로 변경합니다. 코드에서 과금 등급을 검증할 수 없으므로 이 값은 실수 방지를 위한 **수동 승인 플래그이지 과금 차단 보증은 아닙니다.**

```bash
cd /Users/ungveloper/Desktop/UNG/youtube-video-analyzer-web
cp -n .env.example .env.local
# .env.local을 텍스트 편집기로 열어 3개 값을 설정
npm run dev -- --hostname 127.0.0.1
```

`http://localhost:3000` 대신 `http://127.0.0.1:3000`으로 접속합니다. `npm run dev`에서 변경된 .env.local을 적용하려면 서버를 재시작하세요. `GEMINI_FREE_TIER_CONFIRMED=false`이면 AI 요청이 비활성화됩니다. `.env.local`에는 비밀 API 키가 들어 있으므로 절대 Git에 커밋하지 마세요.

### 무료라고 해서 무조건 과금이 차단되지는 않습니다

- Gemini 모델의 **Free Tier 가격은 0달러**이지만, **Paid Tier API 키**를 사용하면 해당 등급의 청구가 적용될 수 있습니다. **API 호출만으로 키가 어떤 결제 등급인지 확실히 확인할 방법은 제공하지 않습니다.** 과금 없는 이용을 위해 프로젝트에 Cloud Billing을 연결하지 마세요.
- 무료 티어 요청/토큰 제한은 AI Studio에 표시되는 실제 계정의 한도에 따릅니다. API가 HTTP 429를 반환하면 분석을 멈춥니다.
- 공개 YouTube URL 직접 입력은 Google 공식 문서에서 무료 미리보기로 안내되지만, 한도 및 정책은 변경될 수 있습니다(무료 등급 YouTube 입력 최대 8시간/일).
- 무료 등급 데이터는 Google의 제품 개선에 이용될 수 있습니다. `store:false`는 Interactions API 대화 상태 저장을 비활성화하며, 무료 등급의 데이터 처리 조건 전체를 무효화하지는 않습니다.
- 로컬 머신의 전기요금/네트워크 사용량과 YouTube API 제한은 별도로 고려해야 합니다.

공식 문서: [Gemini 가격](https://ai.google.dev/gemini-api/docs/pricing) · [YouTube 영상 이해](https://ai.google.dev/gemini-api/docs/video-understanding) · [과금 정책](https://ai.google.dev/gemini-api/docs/billing)

## 사용 방법

1. YouTube ID/URL 입력 → YouTube Data API로 길이·공개 상태 확인 → AI 분석 버튼 클릭.
2. Gemini 무료 모델이 URL 영상을 직접 처리하여 네 가지 탭 데이터(JSON)를 생성. 영상, 음성, 자막을 무단 다운로드하지 않습니다.
3. 화면에는 한국어 요약, 타임라인, 해설 아티클이 표시됩니다. 정확한 발화를 확보하지 못하면 스크립트 탭은 비어 있으며 허구의 전사를 생성하지 않습니다.
4. 모든 항목은 편집 가능합니다. 편집 결과와 AI 원본은 브라우저 IndexedDB에만 저장됩니다. 기존 결과 무료 재열람, MD/TXT/PDF/DOCX 다운로드 지원.

지원하지 않는 공개 YouTube URL이 있을 수 있습니다. API 호출에 성공해도 실제 의미 기반 시간 근거가 맞는지는 수동 검증해야 합니다. 자막 없는 영상의 모든 발화가 정확히 추출된다고 보장하지 않습니다.

## 기술적 제약 및 향후 과제

- 동기 PoC: 첫 요청 최대 175초, 일시적 서버 오류에 한해 재시도 1회 최대 85초. 30분 영상 분석을 10분 안에 완료한다고 보장하지 않습니다.
- AI 작업이 실행되는 동안 브라우저를 닫으면 결과가 유실될 수 있습니다. 로컬 메모리 동시 실행 차단은 단일 개발 서버 프로세스에서만 유효합니다.
- Vercel 등 프로덕션 배포에서는 유료 키 오남용을 막기 위해 `/api/analyze`와 `/api/video`를 기본 차단합니다. 공개 SaaS를 만들 때는 인증, 요청 제한, 비용 제한, 큐/워커를 다시 설계해야 합니다.
- 영상 메타데이터에는 YouTube Data API v3 키가 필요하며 영상은 공개 상태, 길이 1~1800초여야 합니다.
- DOCX 내보내기는 간단한 문단 구조이고 PDF는 이미지 기반으로 텍스트 검색·선택이 제한됩니다.
- README/PRD는 기술 실험용이며, 외부 공개 전 약관/저작권/개인정보 정책을 재검토해야 합니다.

## npm 보안 점검

이 패치는 package.json/lock 버전 변경을 포함하지 않습니다. 설치된 의존성은 Mac에서 `npm audit --omit=dev` 및 `npm audit`로 확인해주세요. `npm audit fix --force`는 호환성 검토 전에 실행하지 마세요.

## v1.2 · 분석 대기 및 오류 진단 개선

- `분석 요청 처리 중…` 상태에 회전 스피너, 경과 시간, **단계 진행률** 표시.
- 단계 진행률은 **애플리케이션에서 완료된 단계** (요청 수신 10%, 영상 확인/AI 실행 30%, 모델 응답 수신 75%, 검증 90%, 브라우저 저장 완료 100%)만 나타냅니다. Gemini 내부 처리율은 확인할 수 없어 분석 중 숫자가 오래 유지될 수 있습니다.
- `POST /api/analyze`는 `text/event-stream` 으로 `progress`, `completed`, `failed` 이벤트를 보냅니다. 작업 중에는 5초마다 연결 유지용 heartbeat를 전송합니다.
- 분석 취소 버튼은 브라우저 요청을 중단하며, 가능한 경우 업스트림 API fetch도 취소합니다. 취소 시 외부 제공자 측 요청량은 반환되지 않을 수 있습니다.
- AI 요청은 최대 110초 + 복구 가능한 오류에 대해 추가 75초로 제한합니다. 합계 약 3분 내 응답 및 후처리를 시도하지만 로컬 환경, 업스트림 상태에 따라 오차가 있습니다.
- `429`(무료 한도), `400`·`401`·`403`·`404`(설정/영상/모델 불가), 미완료 응답, JSON 형식 오류는 **자동 재시도하지 않습니다**. `408`·일시적 `5xx`·응답 시간 초과 등만 최대 1회 재시도합니다.
- 실패 시 사용자에게 에러 분류 코드, Google API HTTP 상태 및 요청 ID 일부를 표시하며, 터미널에는 `analysis.failed` 및 `ai.http_error` 로그를 남깁니다. **API 키는 로그에 쓰지 않습니다.**
- Next.js 16의 smooth-scroll 경고는 `app/layout.tsx`의 `data-scroll-behavior="smooth"` 속성으로 해결합니다.

### 분석이 완료되지 않는 경우

1. 단순 점검은 1~3분짜리 짧은 공개 영상에서 먼저 테스트하세요.
2. 로컬 터미널에서 `ai.http_error`, `analysis.attempt_failed`, `analysis.failed` 이벤트를 확인하세요.
3. 오류 코드와 HTTP 상태만 공유하세요. `.env.local` 값, API 키, 요청/응답 원문을 공유하지 마세요.
4. 입력/모델/API 자체가 지원되지 않는다면 UI를 수정해도 자동 분석을 보장할 수 없습니다. Gemini 무료 등급 계정과 해당 모델의 YouTube URL 지원 여부를 점검해야 합니다.
5. 데이터베이스와 Redis는 여전히 사용하지 않으며, 완료된 결과는 브라우저 IndexedDB에만 저장합니다.

## v1.3 · 무료 모델 연결 진단

- AI 요청의 `generation_config`에서 지원되지 않는 `temperature` 속성을 제거했습니다.
- Google 400/401/403/404/429 오류의 HTTP 상태, 공급자 오류 코드와 안전하게 정리한 상세 내용을 보여줍니다.
- 영상 분석 화면의 **무료 모델 연결 진단** 버튼은 `models.get` 메타데이터만 조회하며 AI 추론을 실행하지 않습니다.
- 메타데이터 접근 성공은 YouTube 영상 입력 성공이나 Free Tier 과금 상태를 보증하지 않습니다.
- 오래된 오류 문구를 제거하여 ESLint `no-unused-vars` 경고를 해결했습니다.
- 상세: `docs/PRD-v1.3-provider-diagnostics.md`.

## v1.4 · 라이브위키 수준의 상세한 설명을 목표로 분석 밀도 개선

- Gemini 무료 모델 변경 없음. **AI 호출 1회**가 기본이며, 상세도를 높이기 위한 자동 재호출 없음.
- 입력 영상 길이에 따라 요약·타임라인·아티클의 개별 논점 수와 설명 밀도를 요청합니다. 분량보다 원본 영상과의 일치를 우선하며 근거가 없으면 축약합니다.
- 요약은 번호별 포인트, 타임라인은 영상 시간 순서, 아티클은 문단과 소제목이 읽기 좋은 상세 문서 형태로 표시합니다.
- 결과가 지나치게 짧을 때 상세도 안내를 보여주며, 서버 로그 `analysis.completed`에 `contentMetrics`와 `shortFields`가 남습니다.
- 기존 브라우저 저장 결과를 자동으로 수정하지 않습니다. **이전 결과를 상세 분석으로 바꾸려면 `다시 분석` 버튼을 눌러 무료 AI API 요청을 새로 실행해야 합니다.**
- 무료 한도, 소스 영상의 내용, 발화 인식 및 모델 특성 때문에 라이브위키의 글자 수나 품질을 동일하게 보장하지는 않습니다.
- 출력 상한은 16,000 토큰(모델 추론 토큰 포함)이며 `thinking_level: low`를 사용합니다. AI 자체의 영상 분석 진행률은 제공되지 않습니다.
- 세부 명세: `docs/PRD-v1.4-detailed-analysis.md`.


## v1.5 · 타임스탬프 재생 및 선택형 정밀 분석

- `YouTubePlayerEmbed`가 공식 YouTube IFrame API의 `seekTo(seconds, true)` 및 `playVideo()`를 호출합니다. 타임스탬프 클릭 때 iframe URL을 변경하지 않아 플레이어가 썸네일로 다시 로드되지 않습니다. 클릭한 시간을 플레이어 준비 전에는 대기하고, 재생 오류 또는 자동재생 차단에 대비해 원본 YouTube 시각 링크를 제공합니다. 브라우저/YouTube 정책에 따라 자동 재생이 제한될 수 있습니다.
- 분석 깊이를 **기본(1회 호출)**, **정밀(최대 2회 호출)** 가운데 선택합니다. 정밀 모드에서는 첫 결과의 항목 수나 해설 분량이 목표에 미달할 경우 같은 영상 URL을 두 번째 무료 Gemini API 요청으로 다시 검토합니다. 재시도까지 합쳐 최대 2회이며 유료 모델 전환은 없습니다. 영상 입력 무료 할당량은 최대 2배 소비될 수 있습니다.
- 두 번째 결과의 자료구조와 시간 범위를 다시 검사하고 밀도 점수가 증가한 경우에만 채택합니다. 추가 요청이 HTTP 429/오류/시간초과로 실패하면 정상적인 첫 결과를 유지합니다. 이 점수는 분량 지표일 뿐 **사실성·정확성을 보증하지 않습니다**. 실질적인 영상 근거 확인은 여전히 중요합니다.
- `analysis.completed` 로그에 `providerCalls`, `deepMode`, `improved`, `contentMetrics`를 출력하여 품질 개선 여부를 비교할 수 있습니다. 콘텐츠 본문, API 키는 로그에 남기지 않습니다.
- 새 정책은 **다시 분석한 결과부터 적용**됩니다. 저장된 기존 결과, IndexedDB, 편집, 문서 내보내기는 바꾸지 않습니다.
- 정밀 모드의 경우 무료 AI 요청 수와 영상 입력 사용량이 늘 수 있으며 30분 영상은 완료 시간이 더 길어질 수 있습니다. 비동기 워커가 없으므로 장시간 분석 제한은 여전히 존재합니다.

## v1.6 · 근거 우선 2단계 분석 및 무료 모델 비교 (v9)

- 사용자가 **Gemini 3.8 Flash**(권장)와 **3.5 Flash-Lite**(기존)를 직접 선택합니다. 공식 표준 Free Tier 가격표의 모델만 코드에서 허용합니다. 사용자 프로젝트의 실제 접근 권한과 무료 할당량은 Google AI Studio에서 확인해야 합니다.
- **기본 분석**은 영상 입력 + 결과 생성 1회입니다. **정밀 분석**은 근거 추출용 영상 호출 1회와, 추출 근거만 입력으로 전달하는 텍스트 기반 상세 아티클 작성 호출 1회로 나눕니다. 최대 두 호출, 유료 자동 전환 없음.
- 1단계는 시간 근거(evidence), 각각의 개별 주장(claims), 확인된 발화가 있을 때만 전사(transcript)를 확보합니다.
- 2단계는 1단계 `claimIds`와 `evidenceIds`에 연결된 설명만 생성합니다. 임의의 새 구간이나 출처 ID는 허용하지 않습니다. 단, 코드 수준 구조 검사는 실제 영상의 의미적 진실성을 보증하지 않으므로 중요한 내용을 원본 영상에서 확인해야 합니다.
- 2단계가 실패할 경우 **상세 해설인 것처럼 꾸미지 않고 1차 근거 요지**를 표시합니다. 생성된 내용과 원본 사실은 구별하며, 발화 확인이 불가능한 스크립트는 비워 둡니다.
- 기존 IndexedDB 결과·편집·내보내기를 유지하며, 이전 기록은 덮어쓰지 않습니다. 같은 영상에서 새 분석을 실행해야 v9 파이프라인을 적용합니다.
- 로컬 전용 안전장치와 `GEMINI_FREE_TIER_CONFIRMED=true` 수동 승인은 유지합니다. 이 값은 Google Cloud Billing 상태를 확인하지 못하며 **과금 방지 기술적 보증이 아닙니다**. 결제 미연결 Free Tier 프로젝트만 사용하세요.
- 진단 버튼은 선택한 모델 메타데이터만 조회하며 추론 호출을 실행하지 않습니다.
- `GET /api/ai-diagnostics?model=gemini-3.8-flash`도 지원합니다. Gemini 3.8 Flash는 `thinking_level: medium`, 3.5 Flash-Lite는 `low`로 요청합니다. 모델별 요청량과 무료 한도 소진(429)을 주의하세요.

자세한 사항은 `docs/PRD-v1.6-evidence-pipeline.md`를 참고하세요.
