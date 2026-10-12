export type Evidence = { id: string; startSeconds: number; endSeconds: number; kind: 'video' | 'audio' | 'caption'; note?: string };
export type GroundedItem = { id: string; title?: string; text: string; evidenceIds: string[]; edited?: boolean };
export type TranscriptLine = { id: string; startSeconds: number; endSeconds: number; text: string; translated: boolean; edited?: boolean };
export type AnalysisContent = { summary: GroundedItem[]; timeline: GroundedItem[]; article: GroundedItem[]; transcript: TranscriptLine[]; exclusions: string[] };
export type VideoInfo = { id: string; title: string; channel: string; thumbnail: string; durationSeconds: number; url: string };
export type AnalysisRecord = {
  id: string; video: VideoInfo; createdAt: string; updatedAt: string; model: string;
  evidence: Evidence[]; original: AnalysisContent; edited: AnalysisContent;
  analysisMeta?: { depth: 'standard' | 'deep'; providerCalls: number; refinement: 'improved' | 'kept-first' | 'not-needed'; pipeline?: 'single-pass' | 'evidence-compose'; sourceClaims?: number; sourceEvidence?: number; sourceMode?: 'user-captions' | 'video-url'; qualityStatus?: 'review' | 'partial'; coveragePercent?: number };
};
export type ApiError = { error: string; code?: string; remaining?: number };
export type QuotaInfo = { remaining: number; completed: number; reserved: number; limit: number; enabled: boolean; reason?: string };
