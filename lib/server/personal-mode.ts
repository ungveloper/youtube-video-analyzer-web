import 'server-only';
import { ServiceError } from '@/lib/server/video';

// Fail closed: no browser request can initiate a billable provider call on a deployed server.
// Run `npm run dev -- --hostname 127.0.0.1` for private experiments.
export const FREE_MODEL = 'gemini-3.5-flash-lite' as const;
export function personalModeStatus(): { enabled: boolean; reason: string } {
  if (process.env.NODE_ENV !== 'development') return { enabled: false, reason: '이 개인용 AI 분석은 로컬 개발 서버에서만 허용됩니다.' };
  if (!process.env.YOUTUBE_API_KEY) return { enabled: false, reason: 'YOUTUBE_API_KEY를 .env.local에 설정해주세요.' };
  if (!process.env.GEMINI_API_KEY) return { enabled: false, reason: '결제 미연결 Free Tier 프로젝트의 GEMINI_API_KEY가 필요합니다.' };
  if (process.env.GEMINI_FREE_TIER_CONFIRMED !== 'true') return { enabled: false, reason: 'Google AI Studio에서 결제 미연결 Free Tier 상태를 확인한 후 GEMINI_FREE_TIER_CONFIRMED=true로 설정해주세요.' };
  return { enabled: true, reason: '개인용 무료 등급 분석 준비됨 · API 제공자의 무료 할당량 내에서만 작동' };
}
export function assertPersonalRequest(request: Request): void {
  // Do not enable the API on Vercel or a production Next.js server.
  if (process.env.NODE_ENV !== 'development') throw new ServiceError('PERSONAL_ONLY', '개인용 분석은 로컬 개발 서버에서만 사용할 수 있습니다.', 403);
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ServiceError('PERSONAL_ONLY', 'localhost에서만 분석할 수 있습니다.', 403);
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ServiceError('INVALID_ORIGIN', '허용되지 않은 분석 요청입니다.', 403);
}
