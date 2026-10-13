/** Google Interactions SSE decoding for one stateless streamed response.
 * No interaction history or model output is stored by this module. */
export type StreamedInteraction = {output: string; inputTokens: number | null; outputTokens: number | null; chunks: number; firstTextMs: number | null};
const MAX_STREAM_TEXT = 2_000_000;
const MAX_STREAM_BUFFER = 3_000_000;

export async function readInteractionSse(response: Response): Promise<StreamedInteraction> {
  if (!response.body) throw new Error('Google 스트리밍 응답 본문이 없습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let firstTextMs: number | null = null;
  let chunks = 0;
  let completed = false;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const started = Date.now();
  const modelSteps = new Set<number>();
  const append = (text: unknown) => {
    if (typeof text !== 'string' || !text.length) return;
    if (output.length + text.length > MAX_STREAM_TEXT) throw new Error('Gemini 스트리밍 응답의 크기 제한을 초과했습니다.');
    if (firstTextMs === null) firstTextMs = Date.now() - started;
    output += text;
    chunks += 1;
  };
  const processEvent = (raw: string) => {
    const lines = raw.split('\n');
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const rawJson = dataLines.join('\n');
    if (rawJson === '[DONE]') return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(rawJson) as Record<string, unknown>; }
    catch { throw new Error('Google 스트리밍 이벤트를 파싱하지 못했습니다.'); }
    const kind = typeof event.event_type === 'string' ? event.event_type : eventName;
    if (kind === 'error' || kind === 'interaction.failed') {
      const error = event.error && typeof event.error === 'object' ? event.error as Record<string, unknown> : {};
      const code = typeof error.code === 'string' ? error.code : 'UNKNOWN';
      const message = typeof error.message === 'string' ? error.message : '모델 처리 실패';
      throw new Error(`Google 스트리밍 처리 실패 (${code}): ${message.slice(0,200)}`);
    }
    if (kind === 'step.start') {
      const step = event.step && typeof event.step === 'object' ? event.step as Record<string, unknown> : {};
      if (step.type === 'model_output' && typeof event.index === 'number') {
        modelSteps.add(event.index);
        if (Array.isArray(step.content)) {
          for (const part of step.content) {
            if (part && typeof part === 'object' && (part as Record<string,unknown>).type === 'text')
              append((part as Record<string,unknown>).text);
          }
        }
      }
    }
    if (kind === 'step.delta') {
      const delta = event.delta && typeof event.delta === 'object' ? event.delta as Record<string,unknown> : {};
      if (delta.type === 'text' && (modelSteps.size === 0 || (typeof event.index === 'number' && modelSteps.has(event.index)))) append(delta.text);
    }
    if (kind === 'interaction.completed') {
      completed = true;
      const interaction = event.interaction && typeof event.interaction === 'object' ? event.interaction as Record<string,unknown> : {};
      const usage = interaction.usage && typeof interaction.usage === 'object' ? interaction.usage as Record<string,unknown> : {};
      inputTokens = typeof usage.total_input_tokens === 'number' ? usage.total_input_tokens : null;
      outputTokens = typeof usage.total_output_tokens === 'number' ? usage.total_output_tokens : null;
    }
  };
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});
      buffer = buffer.replace(/\r\n/g,'\n');
      if (buffer.length > MAX_STREAM_BUFFER) throw new Error('Gemini 스트리밍 이벤트 버퍼 제한 초과');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processEvent(buffer.slice(0,boundary));
        buffer = buffer.slice(boundary+2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
    if (!completed) throw new Error('Google 스트리밍 연결이 완료 이벤트 없이 종료됐습니다.');
    if (!output.trim()) throw new Error('Google 스트리밍 출력이 비어 있습니다.');
    return {output,inputTokens,outputTokens,chunks,firstTextMs};
  } finally { reader.releaseLock(); }
}
