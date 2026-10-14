/** Provider outage guard for one-click short-video analysis.
 * If the first video clip fails with an upstream 503 or timeout, make at most
 * ONE probe with another explicitly allowlisted FREE model. Never retry 429,
 * change to a paid model, or treat a provider failure as evidence of silence.
 */
export type SpeechClipOutcomeForFailure = {failure?:string};
export type SpeechClipFinalFailure =
  | 'FREE_LIMIT' | 'GOOGLE_REQUEST_REJECTED' | 'PROVIDER_BUSY'
  | 'TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESULT';

// Each failed-provider probe has an explicit deadline. Avoid queuing three
// independently expensive video calls before establishing service health.
export const SPEECH_PROBE_TIMEOUT_MS = 45000;
export const SPEECH_CLIP_TIMEOUT_MS = 65000;
export const SPEECH_FALLBACK_WAIT_MS = 1600;

export function shouldTryFreeModelFallback(code:string|undefined):boolean {
  return code==='PROVIDER_BUSY'||code==='TIMEOUT';
}

/** Empty transcripts caused by provider failure must surface upstream codes. */
export function speechClipFailureCode(outcomes:SpeechClipOutcomeForFailure[]):SpeechClipFinalFailure {
  const reasons=new Set(outcomes.map(outcome=>outcome.failure).filter((s):s is string=>Boolean(s)));
  if(reasons.has('FREE_LIMIT'))return 'FREE_LIMIT';
  if(reasons.has('GOOGLE_REQUEST_REJECTED'))return 'GOOGLE_REQUEST_REJECTED';
  if(reasons.has('PROVIDER_BUSY'))return 'PROVIDER_BUSY';
  if(reasons.has('TIMEOUT'))return 'TIMEOUT';
  if(reasons.size)return 'PROVIDER_UNAVAILABLE';
  return 'INVALID_RESULT';
}
