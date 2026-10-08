import type { AnalysisRecord } from '@/lib/types';

export type AnalysisProgress = {
  type: 'progress';
  step: number;
  label: string;
  detail: string;
  attempt?: number;
};
export type AnalysisCompleted = { type: 'completed'; analysis: AnalysisRecord };
export type AnalysisFailed = { type: 'failed'; code: string; message: string; requestId: string };
export type AnalysisEvent = AnalysisProgress | AnalysisCompleted | AnalysisFailed;

// The percentage represents completed application stages, NOT the provider's
// internal video-understanding progress (which Gemini does not expose here).
export function stagePercent(step: number): number {
  return [0, 10, 30, 75, 90, 100][Math.max(0, Math.min(5, Math.trunc(step)))];
}

export async function readAnalysisEvents(
  response: Response,
  onEvent: (event: AnalysisProgress) => void,
): Promise<AnalysisRecord> {
  if (!response.ok || !response.body) {
    let problem: { error?: string; code?: string } = {};
    try { problem = await response.json(); } catch { /* A proxy may return HTML. */ }
    throw new Error(problem.error || `서버 요청 실패 (HTTP ${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('서버에서 예상하지 못한 응답 형식을 받았습니다. 개발 서버를 재시작해주세요.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: AnalysisRecord | null = null;
  let failed: Error | null = null;
  const consume = (frame: string) => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event: AnalysisEvent;
    try { event = JSON.parse(data) as AnalysisEvent; }
    catch { throw new Error('분석 진행 데이터가 손상되었습니다.'); }
    if (event.type === 'progress') onEvent(event);
    else if (event.type === 'completed') completed = event.analysis;
    else if (event.type === 'failed') failed = new Error(`${event.message} (오류 코드: ${event.code}, 요청: ${event.requestId.slice(0, 8)})`);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        consume(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
      if (buffer.length > 2_000_000) throw new Error('분석 진행 데이터가 너무 큽니다.');
      if (failed) throw failed;
      if (completed) return completed;
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (failed) throw failed;
    if (completed) return completed;
    throw new Error('서버 연결이 결과 없이 종료되었습니다. 다시 요청하기 전에 터미널 로그를 확인해주세요.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
