import type {FreeModelId} from '@/lib/free-models';

export function freeTextFallbackModel(
  selected:FreeModelId,
  code:string
):FreeModelId|null{
  if(selected==='gemini-3.8-flash' &&
     (code==='PROVIDER_BUSY'||code==='TIMEOUT')){
    return 'gemini-3.5-flash-lite';
  }
  return null;
}
