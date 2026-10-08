import { NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { analyzeVideo } from '@/lib/server/ai';
import { getVideo, ServiceError } from '@/lib/server/video';
import { assertPersonalRequest, assertSameOrigin, personalModeStatus } from '@/lib/server/personal-mode';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Local-only, in-process concurrency guard. NOT a shared/public SaaS quota system.
let activeAnalysis = false;
export async function POST(request: Request) {
  try {
    assertPersonalRequest(request);
    assertSameOrigin(request);
    const status = personalModeStatus();
    if (!status.enabled) throw new ServiceError('NOT_CONFIGURED', status.reason, 503);
    const body = await request.json() as { videoId?: unknown; requestId?: unknown };
    const id = typeof body.videoId === 'string' ? extractVideoId(body.videoId) : null;
    const requestId = typeof body.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(body.requestId) ? body.requestId : null;
    if (!id || !requestId) throw new ServiceError('INVALID_REQUEST', '잘못된 분석 요청입니다.', 400);
    if (activeAnalysis) throw new ServiceError('ACTIVE_JOB', '이미 진행 중인 분석이 있습니다. 완료 후 다시 시도해주세요.', 409);
    activeAnalysis = true;
    try {
      const video = await getVideo(id);
      const result = await analyzeVideo(video, requestId);
      return NextResponse.json({ analysis: result }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      activeAnalysis = false;
    }
  } catch (error) {
    return NextResponse.json({ code: error instanceof ServiceError ? error.code : 'ANALYSIS_ERROR', error: error instanceof Error ? error.message : '분석에 실패했습니다.' }, { status: error instanceof ServiceError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
