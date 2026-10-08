import { NextResponse } from 'next/server';
import { assertPersonalRequest, personalModeStatus, FREE_MODEL, freeModelId } from '@/lib/server/personal-mode';
import { googleErrorDetail, googleErrorMessage } from '@/lib/server/google-error';
import { ServiceError } from '@/lib/server/video';
import type { FreeModelId } from '@/lib/free-models';

export const runtime = 'nodejs';

// Local-only metadata request. Does NOT call the generation endpoint.
export async function GET(request: Request) {
  let model: FreeModelId = FREE_MODEL;
  try {
    assertPersonalRequest(request);
    const url = new URL(request.url);
    model = freeModelId(url.searchParams.get('model')) || FREE_MODEL;
    const status = personalModeStatus();
    if (!status.enabled) return NextResponse.json({ok:false,model:model,message:status.reason,kind:'CONFIGURATION'},{headers:{'Cache-Control':'no-store'}});
    const key = process.env.GEMINI_API_KEY;
    if (!key) return NextResponse.json({ok:false,model:model,message:'GEMINI_API_KEY가 없습니다.',kind:'CONFIGURATION'},{headers:{'Cache-Control':'no-store'}});
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers:{'x-goog-api-key':key},cache:'no-store',signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const {code,detail}=googleErrorDetail(await response.text().catch(() => ''));
      return NextResponse.json({ok:false,model:model,kind:'MODEL_METADATA',httpStatus:response.status,code,
        message:googleErrorMessage(response.status,{code,detail})}, {headers:{'Cache-Control':'no-store'}});
    }
    const data = await response.json() as {name?:string;displayName?:string};
    return NextResponse.json({ok:true,model:model,displayName:data.displayName||data.name||model,
      message:'모델 메타데이터 조회 성공. API 키와 모델 정보 접근은 확인됐습니다. 단, 무료 등급 여부·YouTube URL 분석 가능 여부·과금 여부는 확인되지 않았습니다.'},
      {headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    const message = error instanceof ServiceError ? error.message : error instanceof Error && error.name === 'TimeoutError'
      ? 'Google 모델 조회가 10초 안에 완료되지 않았습니다. 네트워크 상태를 확인해주세요.' : '모델 메타데이터 조회에 실패했습니다. 로컬 서버 로그를 확인해주세요.';
    return NextResponse.json({ok:false,model:model,kind:'NETWORK_OR_ACCESS',message},
      {status:error instanceof ServiceError?error.status:502,headers:{'Cache-Control':'no-store'}});
  }
}
