// Client-safe allowlist. Server validates the same IDs; never allow arbitrary paid models.
export const FREE_MODELS = [
  {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash · 상세 이해'},
  {id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash-Lite · 빠른 분석'},
] as const;
export type FreeModelId = typeof FREE_MODELS[number]['id'];
export const FREE_MODEL:FreeModelId='gemini-3.8-flash';
export function freeModelId(value:unknown):FreeModelId|null {
  return typeof value==='string' && FREE_MODELS.some(x=>x.id===value)?value as FreeModelId:null;
}
