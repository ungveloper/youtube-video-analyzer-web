import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
const source=fs.readFileSync('lib/server/ytdlp-captions.ts','utf8');
const js=ts.transpileModule(source,{fileName:'lib/server/ytdlp-captions.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(js.diagnostics?.length??0,0);
const lib={};Function('require','exports',js.outputText)(createRequire(import.meta.url),lib);
const {vttToSrt,parseTimedCaptionSrt}=lib;
const reference=fs.readFileSync('tests/fixtures/livewiki-202s-28.srt','utf8');
const src=parseTimedCaptionSrt(reference,202);
assert.equal(src.length,28);
const pad=n=>String(n).padStart(2,'0');
const stamp=n=>`${pad(Math.floor(n/3600))}:${pad(Math.floor(n/60)%60)}:${pad(Math.floor(n)%60)}.${String(Math.round(n*1000)%1000).padStart(3,'0')}`;
const words=src.flatMap(c=>{
  const tokens=c.text.split(/\s+/);
  return tokens.map((text,i)=>({text,time:c.startSeconds+(c.endSeconds-c.startSeconds)*i/tokens.length}));
});
// Simulate 67 rolling video cues created from 28 distinct LiveWiki segments:
// each cue contains 10 words, advancing only 5 words at a time.
const raw=[];
for(let i=0;i<words.length;i+=5){
 const w=words.slice(i,i+10);if(!w.length)break;
 raw.push({start:w[0].time,end:Math.min(202,w.at(-1).time+.8),text:w.map(x=>x.text).join(' ')});
}
const rollingVtt='WEBVTT\n\n'+raw.map(c=>`${stamp(c.start)} --> ${stamp(Math.max(c.start+.15,c.end))}\n<c>${c.text}</c>`).join('\n\n')+'\n';
const compact=vttToSrt(rollingVtt,202);
assert(compact && compact.count<raw.length*.7,`Rolling ${raw.length} frames should compact, got ${compact?.count}`);
const cleaned=parseTimedCaptionSrt(compact.srt,202);
const norm=s=>s.replace(/\s+/g,' ').trim();
assert.equal(norm(cleaned.map(x=>x.text).join(' ')),norm(words.map(w=>w.text).join(' ')),'Each original word retained once in order');
assert(cleaned.every((l,i)=>i===0||l.startSeconds>=cleaned[i-1].startSeconds),'Start seconds must not reverse');
assert(cleaned.every(l=>l.endSeconds>l.startSeconds),'No zero/negative durations');
assert(cleaned.some(l=>l.text.includes('젊은 사람들은 디스크 탈출증')),'Keep spine discussion');
assert(cleaned.some(l=>l.text.includes('감사합니다.')),'Keep full last phrase');
const fragments=[
[128,131,'같은 현상이 반복되는 것이 특징입니다. 많은 환자분들이 허리질환'],
[131,135,'특징입니다. 많은 환자분들이 허리질환 특히 젊은 사람들은 디스크 탈출증'],
[135,138,'특히 젊은 사람들은 디스크 탈출증 그다음에 나이드신 분들은 척추관'],
[138,141,'그다음에 나이드신 분들은 척추관 협착증 같은 허리 질환으로'],
[141,144,'협착증 같은 허리 질환으로 많이 혼동되곤 합니다. 하지만 이런'],
[144,148,'많이 혼동되곤 합니다. 하지만 이런 허리에 의한 질환과 동맥의 폐색에'],
[148,152,'허리에 의한 질환과 동맥의 폐색에 의한 질환은 엄격하게 구분이 되지요.'],
[152,157,'의한 질환은 엄격하게 구분이 되지요. 마트에서 허리를 굽혀 카트에 몸을 기대서'],
[157,161,'마트에서 허리를 굽혀 카트에 몸을 기대서 걸으시면 호전되는 경우입니다.'],
[161,164,'걸으시면 호전되는 경우입니다.'],
];
const midVtt='WEBVTT\n\n'+fragments.map(([s,e,t])=>`${stamp(s)} --> ${stamp(e)}\n${t}`).join('\n\n')+'\n';
const mid=vttToSrt(midVtt,202);
const midText=parseTimedCaptionSrt(mid.srt,202).map(x=>x.text).join(' ');
assert.equal((midText.match(/많은 환자분들이 허리질환/g)||[]).length,1);
assert.equal((midText.match(/특히 젊은 사람들은 디스크 탈출증/g)||[]).length,1);
assert.equal((midText.match(/마트에서 허리를 굽혀 카트에 몸을 기대서/g)||[]).length,1);
// The user's actual final 20 seconds consist of two rolling subtitle lines
// per display. The introduction, recommendation and full sign-off must not
// repeat even when individual VTT frames overlap by ~50%.
const ending=[
 [167,170,'경우는 털도 나지 않는 것이 특징이 되겠습니다. 이렇 일상생활에서 손쉽게'],
 [170,173,'되겠습니다. 이렇 일상생활에서 손쉽게 체크할 수 있으니 여러분의'],
 [173,175,'체크할 수 있으니 여러분의 다리에 이런 신호가 온다면 이건'],
 [175,177,'다리에 이런 신호가 온다면 이건 단순한 피로에 의한 것이'],
 [177,179,'단순한 피로에 의한 것이 아니에요. 몸에 보내는 경고등이기도'],
 [179,181,'아니에요. 몸에 보내는 경고등이기도 합니다. 혈관도 청소가 필요합니다.'],
 [181,184,'합니다. 혈관도 청소가 필요합니다. 우리 몸속에 있는 혈관 상수도도 한번'],
 [184,186,'우리 몸속에 있는 혈관 상수도도 한번 점검해 보는 시간을 가져 보시길'],
 [186,188,'점검해 보는 시간을 가져 보시길 바랍니다.'],
 [188,190,'바랍니다. 청맥병원 변승제 원장입니다.'],
 [190,192,'청맥병원 변승제 원장입니다. 감사합니다.'],
];
const endingVtt='WEBVTT\n\n'+ending.map(([s,e,t])=>`${stamp(s)} --> ${stamp(e)}\n${t}`).join('\n\n')+'\n';
const endingClean=parseTimedCaptionSrt(vttToSrt(endingVtt,202).srt,202).map(x=>x.text).join(' ');
assert.equal((endingClean.match(/혈관도 청소가 필요합니다/g)||[]).length,1,'Closing recommendation must appear once');
assert.equal((endingClean.match(/청맥병원 변승제 원장입니다/g)||[]).length,1,'Goodbye must appear once');
assert.equal((endingClean.match(/몸에 보내는 경고등이기도/g)||[]).length,1,'Closing warning must appear once');
const nonRollingVtt='WEBVTT\n\n'+src.map(c=>`${stamp(c.startSeconds)} --> ${stamp(c.endSeconds)}\n${c.text}`).join('\n\n')+'\n';
const manual=vttToSrt(nonRollingVtt,202);
assert.equal(manual.count,28,'Normal cues must remain 28');
assert.deepEqual(parseTimedCaptionSrt(manual.srt,202).map(l=>l.text),src.map(l=>l.text),'Manual words must be untouched');
console.log(`PASS: ${raw.length} rolling VTT displays -> ${compact.count} unique ordered cues; real overlap deduped; 28 manual cues untouched`);
