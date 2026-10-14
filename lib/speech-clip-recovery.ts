/** Bounded recovery policy for the one-click speech-only clip pipeline.
 * Never treat a Google 503 response as evidence that a video has no speech.
 * Do not retry free-tier quota exhaustion or silently change paid/free models.
 */
import { BUSY_RETRY_DELAY_MS } from './provider-retry';

export type SpeechClipOutcomeForFailure = {failure?:string};
export type SpeechClipFinalFailure =
  | 'FREE_LIMIT' | 'GOOGLE_REQUEST_REJECTED' | 'PROVIDER_BUSY'
  | 'TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESULT';

/** Two consecutive unsuccessful provider-busy recoveries stop further requests.
 * Delay grows from 2.4s to 4.8s; the first pass remains at most three calls.
 */
export function speechClipRetryDelayMs(code:string|undefined,consecutiveBusy:number):number|null {
  if(code!=='PROVIDER_BUSY'||!Number.isInteger(consecutiveBusy)||consecutiveBusy<0||consecutiveBusy>=2)return null;
  return BUSY_RETRY_DELAY_MS*(consecutiveBusy+1);
}

/** An empty transcript is a data-quality failure ONLY if it is not explained
 * by a rejected/failed upstream request. Preserve the actionable provider code.
 */
export function speechClipFailureCode(outcomes:SpeechClipOutcomeForFailure[]):SpeechClipFinalFailure {
  const reasons=new Set(outcomes.map(outcome=>outcome.failure).filter((s):s is string=>Boolean(s)));
  if(reasons.has('FREE_LIMIT'))return 'FREE_LIMIT';
  if(reasons.has('GOOGLE_REQUEST_REJECTED'))return 'GOOGLE_REQUEST_REJECTED';
  if(reasons.has('PROVIDER_BUSY'))return 'PROVIDER_BUSY';
  if(reasons.has('TIMEOUT'))return 'TIMEOUT';
  if(reasons.size)return 'PROVIDER_UNAVAILABLE';
  return 'INVALID_RESULT';
}
