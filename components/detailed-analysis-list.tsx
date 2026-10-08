'use client';
import type { Evidence, GroundedItem, TranscriptLine } from '@/lib/types';
import { timestamp } from '@/lib/youtube';

type Tab = 'summary' | 'timeline' | 'article' | 'transcript';
export function DetailedAnalysisList({
  tab, items, evidence, editing, onSeek, onTitleChange, onTextChange,
}: {
  tab: Tab;
  items: (GroundedItem | TranscriptLine)[];
  evidence: Evidence[];
  editing: boolean;
  onSeek: (seconds: number) => void;
  onTitleChange: (id: string, title: string) => void;
  onTextChange: (id: string, text: string) => void;
}) {
  const evidenceMap = new Map(evidence.map(item => [item.id, item]));
  const ordered = tab === 'timeline'
    ? [...items].sort((left, right) => {
        const getStart = (item: GroundedItem | TranscriptLine) => {
          if ('startSeconds' in item) return item.startSeconds;
          return Math.min(...item.evidenceIds.map(id => evidenceMap.get(id)?.startSeconds ?? Number.POSITIVE_INFINITY));
        };
        return getStart(left) - getStart(right);
      })
    : items;

  return <div className={tab === 'article' ? 'space-y-9' : 'space-y-3'}>
    {ordered.map((item, index) => {
      const transcript = 'startSeconds' in item;
      const refs = transcript ? [] : item.evidenceIds.map(id => evidenceMap.get(id)).filter((v): v is Evidence => v !== undefined);
      const firstTime = transcript ? item.startSeconds : refs.length ? Math.min(...refs.map(ref => ref.startSeconds)) : null;
      const title = transcript ? '' : item.title;
      return <section key={item.id} className={tab === 'article'
        ? 'border-b border-slate-800/80 pb-8 last:border-0 last:pb-0'
        : tab === 'summary'
          ? 'rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5'
          : 'rounded-xl border border-slate-800/70 bg-slate-950/40 p-4'}>
        <div className="flex items-start gap-3">
          {tab === 'summary' && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-200">{String(index + 1).padStart(2, '0')}</span>}
          {tab !== 'summary' && firstTime !== null && <button type="button" onClick={() => onSeek(firstTime)} aria-label={`${timestamp(firstTime)}부터 영상 재생`} className="shrink-0 rounded-md bg-indigo-500/10 px-2 py-1.5 text-xs font-semibold tabular-nums text-indigo-200 hover:bg-indigo-500/20">{timestamp(firstTime)}</button>}
          <div className="min-w-0 flex-1 space-y-3">
            {tab === 'article' && <p className="text-[11px] font-medium tracking-widest text-indigo-300">SECTION {String(index + 1).padStart(2, '0')}</p>}
            {title && (editing
              ? <input aria-label="항목 제목 편집" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold focus:border-indigo-400 focus:outline-none" value={title} onChange={(event: {target: {value: string}}) => onTitleChange(item.id, event.target.value)}/>
              : <h3 className={tab === 'article' ? 'text-lg font-bold leading-8 text-slate-100' : 'text-sm font-semibold leading-6 text-slate-100'}>{title}</h3>)}
            {editing
              ? <textarea aria-label="내용 편집" className="min-h-36 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm leading-7 text-slate-100 outline-none focus:border-indigo-400" value={item.text} onChange={(event: {target: {value: string}}) => onTextChange(item.id, event.target.value)}/>
              : <div className={tab === 'article' ? 'space-y-4 text-[15px] leading-8 text-slate-300' : 'space-y-3 text-sm leading-7 text-slate-300'}>{item.text.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p className="whitespace-pre-wrap break-words" key={i}>{paragraph.trim()}</p>)}</div>}
            {item.edited && <p className="text-xs text-amber-300">사용자 수정본 · 영상 근거를 다시 확인해주세요.</p>}
            {transcript && item.translated && <p className="text-xs text-indigo-300">원본 발화에 기반한 한국어 번역</p>}
            {refs.length > 0 && <div className="flex flex-wrap items-center gap-2 pt-2" aria-label="영상 근거 링크">
              <span className="text-[11px] text-slate-500">영상 근거</span>
              {refs.map(ref => <button key={ref.id} type="button" onClick={() => onSeek(ref.startSeconds)} title={ref.note || '관련 영상 구간 재생'} className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium tabular-nums text-indigo-200 hover:bg-indigo-500/20">▶ {timestamp(ref.startSeconds)}–{timestamp(ref.endSeconds)}</button>)}
            </div>}
          </div>
        </div>
      </section>;
    })}
  </div>;
}
