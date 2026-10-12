/** Pure time-window planning. A time window is a request for evidence, not proof that the video has been heard. */
import type { Evidence } from './types';
export function mmss(seconds:number):string {
 const n=Math.max(0,Math.round(seconds));
 return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
}
export function coverageWindows(duration:number){
 const cut=[0,0.25,0.5,0.75,1].map(x=>Math.floor(duration*x));
 return cut.slice(0,4).map((start,i)=>({from:start,to:cut[i+1],label:`${mmss(start)}–${mmss(cut[i+1])}`}));
}
/** Detect unanchored final third without using an endSeconds spanning a broad interval. */
export function hasLateAnchors(evidence:Evidence[],duration:number):boolean {
 if(duration<=0)return false;
 return evidence.some(e=>Number.isFinite(e.startSeconds)&&e.startSeconds>=duration*0.70&&e.startSeconds<=duration);
}
export function missingEvidenceWindows(evidence:Evidence[],duration:number):string[]{
 if(duration<=0)return [];
 return coverageWindows(duration).filter(w=>!evidence.some(e=>e.startSeconds>=w.from&&e.startSeconds < w.to)).map(w=>w.label);
}
