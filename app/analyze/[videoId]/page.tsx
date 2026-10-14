import type { Metadata } from 'next';
import { AnalysisWorkspace } from '@/components/analysis-workspace';
export const metadata:Metadata={title:'영상 분석'};
export default async function Page({params,searchParams}:{params:Promise<{videoId:string}>;searchParams:Promise<{start?:string|string[]}>}){
  const [{videoId},query]=await Promise.all([params,searchParams]);
  return <AnalysisWorkspace key={videoId} videoId={videoId} autoAnalyze={query.start==='1'}/>;
}
