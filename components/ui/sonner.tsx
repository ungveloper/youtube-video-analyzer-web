"use client";
import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

/** Match the existing navy/indigo application theme; do not require next-themes. */
export function Toaster() {
  return <Sonner theme="dark" position="top-right" closeButton richColors={false}
    visibleToasts={3} duration={3600} offset="24px"
    toastOptions={{
      className: 'yva-toast',
      style: {
        '--normal-bg': '#141b29',
        '--normal-text': '#f1f5f9',
        '--normal-border': '#334155',
        background: '#141b29', color: '#f1f5f9', border: '1px solid #334155',
        boxShadow: '0 16px 40px rgba(0,0,0,.42)',
      } as CSSProperties,
    }} />;
}
