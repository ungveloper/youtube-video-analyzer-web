"use client";
import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

/** Match the existing navy/indigo application theme; do not require next-themes. */
export function Toaster() {
  return <Sonner theme="dark" position="bottom-right" closeButton richColors={false}
    visibleToasts={5} expand gap={12} duration={4200} offset="24px" mobileOffset="14px"
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
