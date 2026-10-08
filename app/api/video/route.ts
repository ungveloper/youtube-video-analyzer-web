import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { getVideo, ServiceError } from '@/lib/server/video';
import { assertPersonalRequest } from '@/lib/server/personal-mode';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  const id = extractVideoId(req.nextUrl.searchParams.get('id') || '');
  if (!id) return NextResponse.json({ code: 'INVALID_VIDEO_ID', error: '올바른 영상 ID가 아닙니다.' }, { status: 400 });
  try {
    assertPersonalRequest(req);
    return NextResponse.json(await getVideo(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ code: error instanceof ServiceError ? error.code : 'VIDEO_UNAVAILABLE', error: error instanceof Error ? error.message : '영상 정보를 가져오지 못했습니다.' }, { status: error instanceof ServiceError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
