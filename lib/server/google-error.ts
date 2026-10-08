/** Safe Google API diagnostic details. Never return raw bodies or API keys. */
export type GoogleErrorDetail = { code: string; detail: string };

function clean(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{25,}/g, '[API 키 숨김]')
    .replace(/(key|api_key|x-goog-api-key)\s*[:=]\s*[^\s,&]+/gi, '$1=[숨김]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL 숨김]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 350).trim();
}
export function googleErrorDetail(raw: string): GoogleErrorDetail {
  try {
    const obj: unknown = JSON.parse(raw);
    const error = obj && typeof obj === 'object' && 'error' in obj ? obj.error : null;
    if (!error || typeof error !== 'object') return {code:'UNKNOWN',detail:''};
    const data = error as {status?:unknown;message?:unknown};
    return {
      code: typeof data.status === 'string' ? clean(data.status.replace(/[^A-Z_]/g,'')) || 'UNKNOWN' : 'UNKNOWN',
      detail: typeof data.message === 'string' ? clean(data.message) : '',
    };
  } catch { return {code:'UNKNOWN',detail:''}; }
}
export function googleErrorMessage(status: number, details: GoogleErrorDetail): string {
  const suffix = `Google HTTP ${status} (${details.code})`;
  const next = details.detail ? ` 제공자 설명: ${details.detail}` : '';
  if (status === 400) return `Google이 요청 형식을 거절했습니다. API 입력 또는 모델의 지원 기능을 확인해주세요. ${suffix}.${next}`;
  if (status === 401) return `Gemini API 인증이 실패했습니다. 키를 다시 확인해주세요. ${suffix}.${next}`;
  if (status === 403) return `현재 API 키로 요청할 권한이 없습니다. 프로젝트·API 키 제한·지역·무료 등급을 확인해주세요. ${suffix}.${next}`;
  if (status === 404) return `지정 모델 또는 API 경로를 찾을 수 없습니다. ${suffix}.${next}`;
  if (status === 429) return `무료 등급 요청 한도에 도달했습니다. 유료 모델로 전환하지 않습니다. ${suffix}.${next}`;
  return `Gemini 제공자 요청 실패. ${suffix}.${next}`;
}
