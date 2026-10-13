/** A bounded, user-controllable retry for Google HTTP 503 only. No paid model fallback. */
export const BUSY_RETRY_DELAY_MS = 2400;
export function shouldRetryProviderBusy(code: string | undefined, attemptIndex: number, enabled: boolean): boolean {
  return enabled && attemptIndex === 0 && code === 'PROVIDER_BUSY';
}
/** Waiting can be cancelled without sending another provider request. */
export function waitBeforeProviderRetry(signal?: AbortSignal, delayMs = BUSY_RETRY_DELAY_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('분석 중단됨')); return; }
    const finish = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new Error('분석 중단됨')); };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener('abort', onAbort, {once:true});
  });
}
