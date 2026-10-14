import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'lib/segmented-speech.ts'),'utf8');
const output=ts.transpileModule(source,{
  fileName:'lib/segmented-speech.ts',
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true,
});
assert.equal(output.diagnostics?.length??0,0);
const exports={};
Function('exports','require',output.outputText)(exports,()=>{throw Error('Unexpected runtime dependency');});
const {precisionSpeechSegments,parseSegmentedSpeech}=exports;
const segments=precisionSpeechSegments(202,'static');
assert.equal(segments.length,6);

// A context utterance at coreTo+1 MUST NOT displace the actual utterance
// at the next core's coreFrom+2. v3.9 mistakenly broadened ownership to +/-2s.
const clips=segments.map(s=>({
  segmentIndex:s.index,
  lines:[
    {startSeconds:s.coreFrom-s.from+2,endSeconds:s.coreFrom-s.from+5,
      text:`${s.index}번 코어 영역에서 시작한 독립적인 실제 발언입니다.`},
    {startSeconds:s.coreTo-s.from+1,endSeconds:Math.min(s.to-s.from,s.coreTo-s.from+3),
      text:`${s.index}번 이웃 문맥의 경계 발언이며 이번 코어에 속하지 않습니다.`},
  ],
}));
const parsed=parseSegmentedSpeech({segmentTranscripts:clips},segments);
assert.deepEqual(parsed.lines.map(x=>x.startSeconds),[2,36,69,103,137,170]);
assert.equal(parsed.lines.length,6,'Neighboring context must never replace owned starts');
assert(parsed.rejected>=5,'Reject context-only starts outside core ownership');

// A genuine sentence starting INSIDE its core is kept even if it ends
// in the clip overlap context: do not truncate useful words at the boundary.
const s=segments[0];
const edge=parseSegmentedSpeech({segmentTranscripts:[{
  segmentIndex:s.index,
  lines:[{startSeconds:s.coreTo-s.from-2,endSeconds:s.coreTo-s.from+3,
    text:'이 문장은 담당 구간 마지막에 시작해 다음 문맥 영역에서 끝나는 실제 발언입니다.'}],
}]},[s]);
assert.equal(edge.lines.length,1);
assert.equal(edge.lines[0].startSeconds,32);
assert.equal(edge.lines[0].endSeconds,37);
console.log('PASS: v3.9 context ownership regression; core starts stay 2,36,69,103,137,170; boundary-crossing sentence retained');
