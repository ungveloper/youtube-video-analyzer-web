import { NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { analyzeVideo } from '@/lib/server/ai';
import { getVideo, ServiceError } from '@/lib/server/video';
import { assertPersonalRequest, assertSameOrigin, personalModeStatus, freeModelId } from '@/lib/server/personal-mode';
import type { AnalysisEvent, AnalysisProgress } from '@/lib/analysis-stream';
import { MAX_CAPTION_CHARS } from '@/lib/caption-input';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Single-process local personal mode only. No Redis or result database.
let activeAnalysis = false;

export async function POST(request: Request) {
  try {
    assertPersonalRequest(request);
    assertSameOrigin(request);
    const status = personalModeStatus();
    if (!status.enabled) throw new ServiceError('NOT_CONFIGURED', status.reason, 503);
    const body = await request.json() as { videoId?: unknown; requestId?: unknown; depth?: unknown; model?: unknown; captionText?: unknown };
    const captionText=typeof body.captionText==='string'?body.captionText:'';
    if(captionText.length>MAX_CAPTION_CHARS || (body.captionText!==undefined && typeof body.captionText!=='string')) throw new ServiceError('CAPTION_TOO_LARGE','SRT/VTT 자막 입력 제한을 확인해주세요.',400);
    const videoId = typeof body.videoId === 'string' ? extractVideoId(body.videoId) : null;
    const requestId = typeof body.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(body.requestId) ? body.requestId : null;
    const depth = body.depth === 'deep' ? 'deep' : 'standard';
    const model = freeModelId(body.model);
    if (!model) throw new ServiceError('INVALID_MODEL', '무료 등급 허용 목록에 없는 AI 모델입니다.', 400);
    if (!videoId || !requestId) throw new ServiceError('INVALID_REQUEST', '잘못된 분석 요청입니다.', 400);
    if (activeAnalysis) throw new ServiceError('ACTIVE_JOB', '이미 진행 중인 분석이 있습니다. 이전 작업을 완료하거나 중단해주세요.', 409);

    activeAnalysis = true;
    const abortController = new AbortController();
    const encoder = new TextEncoder();
    let released = false;
    const release = () => { if (!released) { released = true; activeAnalysis = false; } };
    const abort = () => abortController.abort();
    request.signal.addEventListener('abort', abort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const emit = (event: AnalysisEvent) => {
          if (closed || abortController.signal.aborted) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
          catch { abort(); }
        };
        const heartbeat = setInterval(() => {
          if (!closed && !abortController.signal.aborted) {
            try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { abort(); }
          }
        }, 5000);
        void (async () => {
          try {
            emit({type:'progress', step:1,label:'영상 확인 중',detail:'공개 여부와 영상 길이를 검사합니다.'});
            const video = await getVideo(videoId);
            emit({type:'progress', step:2,label:'영상 확인 완료',detail:'무료 Gemini 모델에 영상 URL을 전달할 준비가 되었습니다.'});
            const onProgress = (event: AnalysisProgress) => emit(event);
            const result = await analyzeVideo(video, requestId, onProgress, abortController.signal, depth, model, captionText);
            emit({type:'completed', analysis: result});
          } catch(error) {
            const code = error instanceof ServiceError ? error.code : 'ANALYSIS_ERROR';
            const message = error instanceof Error ? error.message : '분석 도중 알 수 없는 오류가 발생했습니다.';
            console.error(JSON.stringify({event:'analysis.failed',requestId,code,message:message.slice(0,180)}));
            emit({type:'failed',code,message,requestId});
          } finally {
            closed = true;
            clearInterval(heartbeat);
            request.signal.removeEventListener('abort', abort);
            release();
            try { controller.close(); } catch { /* Client disconnected. */ }
          }
        })();
      },
      cancel() {
        abort();
        // The upstream AbortSignal terminates provider fetch. The background
        // function's finally block releases the in-process mutex.
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch(error) {
    return NextResponse.json({
      code: error instanceof ServiceError ? error.code : 'ANALYSIS_ERROR',
      error: error instanceof Error ? error.message : '분석 요청에 실패했습니다.',
    }, {status: error instanceof ServiceError ? error.status : 502, headers:{'Cache-Control':'no-store'}});
  }
}
