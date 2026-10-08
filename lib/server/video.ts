import 'server-only';
import type { VideoInfo } from '@/lib/types';
import { youtubeUrl } from '@/lib/youtube';
export class ServiceError extends Error { constructor(public code:string,message:string,public status=400){super(message);} }
function parseDuration(iso:string):number{const match=/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);if(!match)return 0;return Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0);}
export async function getVideo(id:string):Promise<VideoInfo>{
  const key=process.env.YOUTUBE_API_KEY;
  if(!key)throw new ServiceError('NOT_CONFIGURED','YouTube Data API 키가 설정되지 않았습니다.',503);
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');url.searchParams.set('id',id);url.searchParams.set('part','snippet,contentDetails,status');url.searchParams.set('key',key);
  let response:Response;
  try{response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});}catch{throw new ServiceError('VIDEO_UNAVAILABLE','YouTube API 연결에 실패했습니다.',502)}
  if(!response.ok){console.error(JSON.stringify({event:'youtube.failure',status:response.status}));throw new ServiceError('VIDEO_UNAVAILABLE','YouTube API 요청이 거부되었습니다. API 키·할당량을 확인해주세요.',502)}
  const data=await response.json() as {items?:Array<{snippet?:{title?:string;channelTitle?:string;thumbnails?:{medium?:{url:string};default?:{url:string}};liveBroadcastContent?:string};contentDetails?:{duration?:string};status?:{privacyStatus?:string}}>} ;
  const item=data.items?.[0];if(!item||item.status?.privacyStatus!=='public')throw new ServiceError('VIDEO_UNAVAILABLE','공개된 영상을 확인할 수 없습니다.',404);
  if(item.snippet?.liveBroadcastContent==='live')throw new ServiceError('VIDEO_UNAVAILABLE','진행 중인 라이브 방송은 분석하지 않습니다.');
  const seconds=parseDuration(item.contentDetails?.duration||'');
  if(seconds<1)throw new ServiceError('VIDEO_UNAVAILABLE','영상 길이를 확인할 수 없습니다.');
  if(seconds>1800)throw new ServiceError('VIDEO_TOO_LONG','최대 30분 이하의 영상만 분석할 수 있습니다.');
  return {id,title:item.snippet?.title||'제목 없음',channel:item.snippet?.channelTitle||'YouTube',thumbnail:item.snippet?.thumbnails?.medium?.url||item.snippet?.thumbnails?.default?.url||'',durationSeconds:seconds,url:youtubeUrl(id)};
}
