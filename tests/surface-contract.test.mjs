import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('every announced Web/PWA/Mini App and bot surface has a static functional path',()=>{
  const output=execFileSync(process.execPath,['scripts/verify-surface-contract.mjs'],{
    cwd:new URL('../',import.meta.url),
    encoding:'utf8'
  });
  const result=JSON.parse(output);
  assert.equal(result.ok,true);
  assert.ok(result.uiControls>=20);
  assert.ok(result.insertions>=20);
  assert.ok(result.commands>=10);
  assert.deepEqual(result.botCommands,['start','app','novo','ajuda','enviar','exportar','importar']);
  assert.equal(result.pwa.display,'standalone');
});
