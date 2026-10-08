'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { timestamp } from '@/lib/youtube';

// Use the supported IFrame Player API to control a stable player instance.
// Changing an iframe's `src` in response to a time click resets playback.
type Player = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  destroy(): void;
};
type YTNamespace = {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    width: string;
    height: string;
    playerVars: { enablejsapi: number; playsinline: number; origin: string };
    events: { onReady: () => void; onError: (event: { data: number }) => void };
  }) => Player;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let loading: Promise<YTNamespace> | null = null;
function loadYoutubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube 플레이어 초기화에 실패했습니다.'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube 플레이어 API 연결에 실패했습니다.'));
    document.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
export type YouTubePlayerHandle = { seekAndPlay(seconds: number): void };
export const YouTubePlayerEmbed = forwardRef<YouTubePlayerHandle, { videoId: string; durationSeconds?: number }>(
  function YouTubePlayerEmbed({ videoId, durationSeconds }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<Player | null>(null);
    const pendingSeek = useRef<number | null>(null);
    const readyRef = useRef(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [selectedTime, setSelectedTime] = useState<number | null>(null);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let cancelled = false;
      let createdPlayer: Player | null = null;
      const mount = document.createElement('div');
      container.appendChild(mount);
      void loadYoutubeApi().then(YT => {
        if (cancelled) return;
        createdPlayer = new YT.Player(mount, {
          videoId,
          width: '100%', height: '100%',
          playerVars: { enablejsapi: 1, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              if (cancelled) return;
              readyRef.current = true;
              setReady(true);
              setError('');
              if (pendingSeek.current !== null) {
                try { createdPlayer?.seekTo(pendingSeek.current, true); createdPlayer?.playVideo(); }
                catch { setError('영상 이동 실패. 원본 시간 링크에서 확인해주세요.'); }
                pendingSeek.current = null;
              }
            },
            onError: event => { if (!cancelled) setError(`YouTube 재생 오류(${event.data}). 원본 링크에서 확인해주세요.`); },
          },
        });
        playerRef.current = createdPlayer;
      }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '플레이어를 불러오지 못했습니다.'); });
      return () => {
        cancelled = true;
        readyRef.current = false;
        pendingSeek.current = null;
        playerRef.current = null;
        try { createdPlayer?.destroy(); } catch { /* Could already have been removed. */ }
        container.replaceChildren();
      };
    }, [videoId]);

    useImperativeHandle(ref, () => ({
      seekAndPlay(seconds: number) {
        const upper = Number.isFinite(durationSeconds) ? durationSeconds! : 86400;
        const target = Math.floor(Math.max(0, Math.min(upper, seconds)));
        setSelectedTime(target);
        if (!readyRef.current || !playerRef.current) {
          pendingSeek.current = target;
          return;
        }
        try {
          playerRef.current.seekTo(target, true);
          playerRef.current.playVideo();
          setError('');
        } catch { setError('영상 이동 실패. 원본 시간 링크에서 확인해주세요.'); }
      },
    }), [durationSeconds]);

    return <div>
      <div className="relative aspect-video bg-black" ref={containerRef} aria-label="YouTube 영상 플레이어" />
      {selectedTime !== null && <p className="px-4 pt-3 text-xs leading-5 text-slate-400" role="status">
        {timestamp(selectedTime)} 이동 {ready ? '· 재생 요청됨' : '· 플레이어 준비 후 이동 예정'}. 브라우저 자동 재생 정책에 따라 재생이 제한될 수 있습니다.{' '}
        <a href={`https://www.youtube.com/watch?v=${videoId}&t=${selectedTime}s`} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline">YouTube에서 해당 시간 열기 ↗</a>
      </p>}
      {error && <p role="alert" className="px-4 pt-2 text-xs leading-5 text-amber-300">{error}</p>}
    </div>;
  },
);
