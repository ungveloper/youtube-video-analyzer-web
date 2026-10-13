/** Gemini Interactions video processing choices. Only validated values leave the API route. */
export type VideoProcessingPreference = 'auto' | 'static' | 'agentic';
export type VideoProcessingMode = 'static' | 'agentic';

/** Google's latency guideline recommends static processing below five minutes. */
export const SHORT_VIDEO_SECONDS = 300;
export function resolveVideoProcessing(
  durationSeconds: number,
  model: string,
  preference: VideoProcessingPreference = 'auto',
): VideoProcessingMode {
  if (preference === 'static' || preference === 'agentic') return preference;
  // Keep Flash-Lite's existing default behavior; long Flash can still use agentic.
  return durationSeconds >= SHORT_VIDEO_SECONDS && model === 'gemini-3.8-flash' ? 'agentic' : 'static';
}
export function isVideoProcessingPreference(value: unknown): value is VideoProcessingPreference {
  return value === 'auto' || value === 'static' || value === 'agentic';
}
