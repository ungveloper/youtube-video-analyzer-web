# PRD v1.2 — 개인용 분석 진행 상태 및 오류 진단

- 범위: 개인용 로컬 무료 모델 PoC, 로그인/Redis/서버 DB 없음.
- API: POST /api/analyze, SSE(application event `type` field: progress/completed/failed), 5초 heartbeat.
- 진행률: UI 작업 단계 진행률(0,10,30,75,90,100%). Gemini 내부 분석률이 아님.
- 진행 화면: spinner, 경과 시간, 현재 단계, 마지막 시도(1/2,2/2), 사용자 중단 버튼.
- 실패: 서버 응답이 종료되면 반드시 완료/실패 이벤트 중 하나 수신. 연결 유실은 오류 표시.
- 모델: gemini-3.5-flash-lite 고정. 무료 키 확인 필요. 유료 자동 폴백 금지.
- 재시도: 408/500/502/503/504/timeout만 1회. 429/인증/입력/JSON 검증 오류는 재시도 없음.
- 타임아웃: 1차 110초, 2차 75초. 긴 영상에서 실패할 수 있으며 성공 보장 없음.
- 결과: 구조 검증 성공 시 브라우저 IndexedDB에 저장. 상세 정보 및 원본 보존.
- Next.js 16 경고: data-scroll-behavior 속성 추가.
- 미검증: 실제 Google 무료 계정과 YouTube URL이 해당 모델에서 정상 처리되는지 실시간 네트워크 테스트 필요.
