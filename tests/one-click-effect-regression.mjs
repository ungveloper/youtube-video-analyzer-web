import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=fs.readFileSync(path.join(root,'components/analysis-workspace.tsx'),'utf8');
const form=fs.readFileSync(path.join(root,'components/video-form.tsx'),'utf8');
const parsed=ts.createSourceFile('analysis-workspace.tsx',workspace,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(parsed.parseDiagnostics.length,0,'The analysis workspace must parse as TSX');
const effects=[];
function visit(node){
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='useEffect') effects.push(node);
  ts.forEachChild(node,visit);
}
visit(parsed);
const autoStart=effects.find(call=>call.getText(parsed).includes('autoStarted.current'));
assert(autoStart,'Missing URL-triggered auto-analysis effect');
const effectCallback=autoStart.arguments[0];
assert(ts.isArrowFunction(effectCallback)&&ts.isBlock(effectCallback.body),'Expected an effect callback block');
const effectText=effectCallback.body.getText(parsed);
assert.match(effectText,/window\.setTimeout\s*\(/,'Schedule the start after the React effect');
assert.match(effectText,/window\.clearTimeout\s*\(\s*startTimer\s*\)/,'Cancel the queued start during cleanup/Strict Mode');
assert.match(effectText,/if\s*\(\s*autoStarted\.current\s*\)\s*return/,'Prevent duplicate starts');
assert.match(effectText,/autoStarted\.current\s*=\s*true/,'Consume the start flag only when starting');
assert.match(effectText,/void\s+begin\s*\(\s*\)/,'The queued callback must initiate analysis');
for(const statement of effectCallback.body.statements){
  const direct=statement.getText(parsed);
  assert(!/^void\s+begin\s*\(/.test(direct),'Never invoke the state-changing begin() directly from the effect');
}
assert.match(form,/router\.push\(`\/analyze\/\$\{id\}\?start=1`\)/,'Keep one-click home-to-analysis routing');
assert.match(workspace,/get\('start'\)\s*!==\s*'1'/,'Retain the URL activation flag');
console.log('PASS: one-click auto analysis queued outside effect; cleanup cancels Strict Mode timer; no synchronous state update; original home navigation retained');
