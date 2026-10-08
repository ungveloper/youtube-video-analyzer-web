import 'server-only';
import { cookies,headers } from 'next/headers';
import { createHash } from 'node:crypto';
import { command,isRedisReady } from '@/lib/server/redis';
import { ServiceError } from '@/lib/server/video';
import type { QuotaInfo } from '@/lib/types';
const LIMIT=3;
const COOKIE='yva_vid';
function day(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function quotaKey(visitor:string){return `yva:quota:${visitor}:${day()}`;}
function activeKey(visitor:string){return `yva:active:${visitor}:${day()}`;}
const countLimit=()=>Math.max(1,Math.min(100000,Number(process.env.GLOBAL_DAILY_ANALYSES||12)||12));
const secondsLimit=()=>Math.max(120,Math.min(864000,Number(process.env.GLOBAL_DAILY_VIDEO_SECONDS||21600)||21600));
export function analysisConfigured(){return isRedisReady()&&Boolean(process.env.YOUTUBE_API_KEY&&process.env.GEMINI_API_KEY&&process.env.QUOTA_HASH_SECRET)&&process.env.ANALYSIS_PAUSED!=='true';}
export async function visitorId(create=false){const jar=await cookies();let id=jar.get(COOKIE)?.value;if(id&&/^[a-f0-9-]{36}$/.test(id))return id;if(!create)return null;id=crypto.randomUUID();jar.set(COOKIE,id,{path:'/',httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:60*60*24*30});return id;}
export async function quotaInfo(visitor:string|null):Promise<QuotaInfo>{
  if(!analysisConfigured())return {completed:0,reserved:0,remaining:0,limit:LIMIT,enabled:false,reason:process.env.ANALYSIS_PAUSED==='true'?'관리자가 신규 분석을 일시 중단했습니다.':'필수 YouTube/AI/Redis/보안 설정이 누락되었습니다.'};
  if(!visitor)return {completed:0,reserved:0,remaining:0,limit:LIMIT,enabled:false};
  const result=await command<[number,number] | null>('HMGET',quotaKey(visitor),'completed','reserved');
  const completed=Number(result?.[0]||0);const active=await command<string|null>('GET',activeKey(visitor));
  const reserved=active?1:0;
  return {completed,reserved,remaining:Math.max(0,LIMIT-completed-reserved),limit:LIMIT,enabled:true};
}
// Atomic Redis reservation: one active job per visitor, max 3 successful/active per day,
// global daily count and worst-case (first + retry) video-second budget. Global limits
// are intentionally never refunded; retries and failures still consume provider resources.
const RESERVE=`
local done=tonumber(redis.call('HGET',KEYS[1],'completed') or '0')
if done>=tonumber(ARGV[2]) then return 0 end
if redis.call('EXISTS',KEYS[2])==1 then return 2 end
if redis.call('EXISTS',KEYS[4])==1 then return 3 end
local requests=tonumber(redis.call('GET',KEYS[3]) or '0')
local seconds=tonumber(redis.call('GET',KEYS[5]) or '0')
if requests>=tonumber(ARGV[3]) or seconds+tonumber(ARGV[4])>tonumber(ARGV[5]) then return 4 end
redis.call('SET',KEYS[4],'1','EX',86400)
redis.call('SET',KEYS[2],ARGV[1],'EX',700)
redis.call('INCR',KEYS[3]); redis.call('EXPIRE',KEYS[3],172800)
redis.call('INCRBY',KEYS[5],tonumber(ARGV[4]));redis.call('EXPIRE',KEYS[5],172800)
redis.call('EXPIRE',KEYS[1],172800)
return 1`;
const SETTLE=`
if redis.call('GET',KEYS[2])~=ARGV[1] then return 0 end
if ARGV[2]=='success' then redis.call('HINCRBY',KEYS[1],'completed',1);redis.call('EXPIRE',KEYS[1],172800) end
redis.call('DEL',KEYS[2]); return 1`;
export async function reserve(visitor:string, requestId:string, seconds:number){
  if(!analysisConfigured())throw new ServiceError('NOT_CONFIGURED','분석 기능이 준비되지 않았거나 중단되었습니다.',503);
  const keyDay=day();const result=await command<number>('EVAL',RESERVE,5,quotaKey(visitor),activeKey(visitor),`yva:global:count:${keyDay}`,`yva:idempotency:${visitor}:${requestId}`,`yva:global:seconds:${keyDay}`,requestId,LIMIT,countLimit(),seconds*2,secondsLimit());
  if(result===0)throw new ServiceError('QUOTA_EXHAUSTED','오늘의 무료 분석 3회를 모두 사용했습니다.',429);
  if(result===2)throw new ServiceError('ACTIVE_JOB','이미 진행 중인 분석이 있습니다.',409);
  if(result===3)throw new ServiceError('DUPLICATE_REQUEST','동일한 분석 요청이 이미 처리되었습니다.',409);
  if(result===4)throw new ServiceError('GLOBAL_LIMIT','전체 무료 AI 할당량 보호를 위해 신규 분석을 중단했습니다.',429);
  if(result!==1)throw new ServiceError('QUOTA_UNAVAILABLE','분석 횟수를 예약하지 못했습니다.',503);
  return keyDay;
}
export async function settle(visitor:string,requestId:string,status:'success'|'failure',reservedDay:string){
  const result=await command<number>('EVAL',SETTLE,2,`yva:quota:${visitor}:${reservedDay}`,`yva:active:${visitor}:${reservedDay}`,requestId,status);
  if(result!==1)console.error(JSON.stringify({event:'quota.settle_mismatch',requestId,status}));
  return result===1;
}
export async function enforceOrigin(request:Request){
  const origin=request.headers.get('origin');
  const hostname=(await headers()).get('host');
  if(!origin||!hostname||new URL(origin).host!==hostname)throw new ServiceError('INVALID_ORIGIN','허용되지 않는 요청입니다.',403);
}
export function visitorIpHash(raw:string){const salt=process.env.QUOTA_HASH_SECRET;if(!salt)return '';return createHash('sha256').update(salt+'|'+raw).digest('hex').slice(0,32);}
export async function limitIp(request:Request){const hash=visitorIpHash(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown');if(!hash)return;
  const key=`yva:ip:${hash}:${new Date().toISOString().slice(0,13)}`;const n=await command<number>('INCR',key);if(n===1)await command<number>('EXPIRE',key,3700);if(n>Math.max(5,Number(process.env.IP_HOURLY_REQUESTS||12)))throw new ServiceError('RATE_LIMIT','요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',429);
}
