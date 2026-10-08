import type { Metadata } from 'next';
import { AnalysisWorkspace } from '@/components/analysis-workspace';
export const metadata:Metadata={title:'영상 분석'};
export default async function Page({params}:{params:Promise<{videoId:string}>}){const {videoId}=await params;return <AnalysisWorkspace key={videoId} videoId={videoId}/>}
