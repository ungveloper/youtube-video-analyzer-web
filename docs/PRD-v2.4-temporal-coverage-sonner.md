# v17 · 시간대별 입력 충실도 및 Sonner

- Sonner: bottom-right, visibleToasts 5, expand on, gap 12. 기존 다크/인디고 토큰 유지.
- Gemini 3.8 Flash: 공식 Interactions API agentic 처리 + video-first input sequence; Flash-Lite 유지.
- 기본 분석 1회: 영상 종료부를 먼저 확인하도록 요구하고 네 시간대를 나눠 지시. 근거 노트가 있지만 타임라인에서 빠졌다면 시간순으로 추가.
- 정밀 분석: 마지막 30%에 시작 근거가 전혀 없으면 선택적 1회 후반 집중 영상 요청; 기존 소스를 유지하면서 실제 확보한 후반 근거만 병합. 추가 호출은 유료 자동 전환을 의미하지 않음.
- 영상 원본을 재생·대조하지 않은 모델의 시각 추정이나 통계 주장은 검증되지 않는다. 자동 누락 발견은 원본 발화 확인률 증명이 아니다.
- 지연/503/429 가능성 있음. 실제 Google 호출과 lint/build는 사용자 Mac에서 최종 확인.
