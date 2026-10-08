import 'server-only';
import { ServiceError } from '@/lib/server/video';
export function isRedisReady(){return Boolean(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN);}
export async function command<T>(...args:(string|number)[]):Promise<T>{
  if(!isRedisReady())throw new ServiceError('NOT_CONFIGURED','사용량 보호를 위한 Redis가 설정되지 않았습니다.',503);
  const response=await fetch(process.env.UPSTASH_REDIS_REST_URL!,{method:'POST',headers:{Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store',signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw new ServiceError('QUOTA_UNAVAILABLE','사용량 확인 서버 연결에 실패했습니다.',503);
  const data=await response.json() as {result:T;error?:string};
  if(data.error)throw new ServiceError('QUOTA_UNAVAILABLE','사용량 저장소 오류가 발생했습니다.',503);
  return data.result;
}
