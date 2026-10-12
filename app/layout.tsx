import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'YouTube AI Analyzer', template: '%s | YouTube AI Analyzer' },
  description: '유튜브 영상을 분석하고 한국어 요약, 타임라인, 아티클, 스크립트를 편집·저장합니다.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko" className="dark" data-scroll-behavior="smooth"><body className="min-h-screen bg-[#090d16] text-slate-100 antialiased"><SiteHeader/>{children}<Toaster/><footer className="mx-auto flex max-w-[1600px] flex-wrap justify-between gap-3 border-t border-slate-800 px-4 py-8 text-xs text-slate-500 sm:px-6"><span>© YouTube AI Analyzer · 개발 및 내부 검증용</span><div className="flex gap-4"><a href="/privacy" className="hover:text-white">개인정보처리 안내</a><a href="/terms" className="hover:text-white">이용 안내</a></div></footer></body></html>;
}
