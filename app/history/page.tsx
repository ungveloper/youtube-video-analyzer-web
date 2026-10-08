import type { Metadata } from 'next';
import { HistoryView } from '@/components/history-view';
export const metadata:Metadata={title:'최근 분석'};
export default function Page(){return <HistoryView/>}
