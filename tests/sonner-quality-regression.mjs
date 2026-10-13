import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
for(const file of ['components/ui/sonner.tsx','components/analysis-workspace.tsx','components/video-form.tsx','components/caption-input-panel.tsx','app/layout.tsx']){
  const out=ts.transpileModule(read(file),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve},reportDiagnostics:true});
  assert.equal(out.diagnostics?.length||0,0,`${file}: syntactic errors`);
}
assert.match(read('app/layout.tsx'),/<Toaster\s*\/>/);
assert.match(read('components/ui/sonner.tsx'),/theme="dark"/);
assert.match(read('components/ui/sonner.tsx'),/#141b29/);
assert.match(read('components/analysis-workspace.tsx'),/toast\.success\(/);
assert.match(read('components/analysis-workspace.tsx'),/toast\.error\(/);
assert.doesNotMatch(read('components/analysis-workspace.tsx'),/toast\.loading\(/);
assert.doesNotMatch(read('components/analysis-workspace.tsx'),/toast\.error\('영상 분석에 실패했습니다/);
assert.match(read('components/video-form.tsx'),/toast\.error\(/);
assert.match(read('lib/server/ai.ts'),/audit\.needsReview/);
console.log('PASS: sonner theme, button feedback, no duplicated provider toast, evidence audit semantics');
