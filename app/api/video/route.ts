import { NextRequest,NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { getVideo,ServiceError } from '@/lib/server/video';
import { limitIp } from '@/lib/server/quota';
import { isRedisReady } from '@/lib/server/redis';
export const runtime='nodejs';
export async function GET(req:NextRequest){const id=extractVideoId(req.nextUrl.searchParams.get('id')||'');if(!id)return NextResponse.json({code:'INVALID_VIDEO_ID',error:'올바른 영상 ID가 아닙니다.'},{status:400});try{if(isRedisReady())await limitIp(req);return NextResponse.json(await getVideo(id),{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({code:e instanceof ServiceError?e.code:'VIDEO_UNAVAILABLE',error:e instanceof Error?e.message:'영상 정보를 가져오지 못했습니다.'},{status:e instanceof ServiceError?e.status:500})}}
