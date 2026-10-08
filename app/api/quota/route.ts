import { NextResponse } from 'next/server';
import { visitorId,quotaInfo } from '@/lib/server/quota';
export const runtime='nodejs';
export async function GET(){try{const visitor=await visitorId(true);return NextResponse.json(await quotaInfo(visitor),{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({enabled:false,remaining:0,reserved:0,completed:0,limit:3,reason:'사용량 서버에 연결할 수 없습니다.'},{headers:{'Cache-Control':'no-store'}})}}
