import { NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { analyzeVideo } from '@/lib/server/ai';
import { getVideo,ServiceError } from '@/lib/server/video';
import { enforceOrigin,limitIp,reserve,settle,visitorId } from '@/lib/server/quota';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){let visitor:string|null=null;let reservedDay:string|null=null;let requestId:string|null=null;
  try{
    await enforceOrigin(request);const body=await request.json() as {videoId?:unknown;requestId?:unknown};
    const id=typeof body.videoId==='string'?extractVideoId(body.videoId):null;
    requestId=typeof body.requestId==='string'&&/^[a-f0-9-]{36}$/i.test(body.requestId)?body.requestId:null;
    if(!id||!requestId)throw new ServiceError('INVALID_REQUEST','잘못된 분석 요청입니다.',400);
    visitor=await visitorId(false);if(!visitor)throw new ServiceError('VISITOR_MISSING','쿠키를 허용하고 다시 시도해주세요.',403);
    await limitIp(request);
    const video=await getVideo(id);
    reservedDay=await reserve(visitor,requestId,video.durationSeconds);
    const result=await analyzeVideo(video,requestId);
    const committed=await settle(visitor,requestId,'success',reservedDay);
    if(!committed)throw new ServiceError('QUOTA_UNAVAILABLE','사용량 정산에 실패했습니다. 운영 로그를 확인해주세요.',503);
    return NextResponse.json({analysis:result},{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    if(visitor&&reservedDay&&requestId){try{await settle(visitor,requestId,'failure',reservedDay)}catch(err){console.error(JSON.stringify({event:'quota.refund_failed',requestId,reason:String(err)}))}}
    const code=e instanceof ServiceError?e.code:'ANALYSIS_ERROR';const status=e instanceof ServiceError?e.status:502;
    return NextResponse.json({code,error:e instanceof Error?e.message:'분석 요청에 실패했습니다.'},{status,headers:{'Cache-Control':'no-store'}});
  }
}
