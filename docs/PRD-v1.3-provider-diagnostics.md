# PRD v1.3 · 무료 Gemini API 요청 호환성 및 진단

- `generation_config.temperature` 삭제: Interactions API `GenerationConfig`에는 해당 필드가 없음. `max_output_tokens`만 유지.
- 화면의 사용하지 않는 오류 코드 문구 모음 삭제(ESLint warning 제거).
- Google HTTP 400/401/403/404/429를 구별하고 공급자 `error.status` 및 **길이를 제한하고 민감 정보를 가린** `error.message` 표시.
- 자동 재시도: 일시적 HTTP 408/5xx와 타임아웃만 최대 한 차례. 429·400·권한 오류는 재시도 안 함.
- `GET /api/ai-diagnostics`: 로컬 `next dev` 환경에서만 모델의 공개 메타데이터를 서버의 API 키로 조회. **분석/토큰 생성 요청이 아니며** API 키·비밀 값은 응답하지 않음.
- 모델 메타데이터 조회가 성공해도 무료 등급, YouTube URL 직접 분석 기능, AI 품질·정확도, 비과금 상태는 검증된 것이 아님.
- Redis/DB 추가하지 않음. AI 원본과 편집본은 IndexedDB에 저장.

## 문제 재현 시

1. `.env.local`의 `GEMINI_FREE_TIER_CONFIRMED=true`는 **결제 미연결 프로젝트** 확인 뒤에만 사용.
2. Next dev 서버 완전 종료 후 `npm run dev -- --hostname 127.0.0.1` 재시작.
3. `http://127.0.0.1:3000`으로 들어와 영상 열기 → `무료 모델 연결 진단` 클릭.
4. 진단 실패 시 화면의 `Google HTTP ### (CODE)`와 공급자 설명 확인. 비밀 키·`.env.local` 전체는 공유하지 말 것.
5. 진단 성공 후 1분 내외의 **공개** YouTube 영상 1건을 분석. 실패 시 분석 화면의 상세 오류와 로컬 서버의 `ai.http_error` 로그 코드 확인.
6. 네트워크 연결이나 API 권한 등 사용자 계정 설정 문제라면 코드 변경만으로 해결할 수 없음.

## 공식 문서

- https://ai.google.dev/api/interactions-api (GenerationConfig)
- https://ai.google.dev/api/models (models.get)
- https://ai.google.dev/gemini-api/docs/video-understanding (YouTube URL)
- https://ai.google.dev/gemini-api/docs/pricing (Free Tier 및 과금)
