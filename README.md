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
