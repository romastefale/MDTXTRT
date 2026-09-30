import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const fail=message=>{throw new Error(message);};
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
const manifest=JSON.parse(readFileSync(new URL('../RELEASE_MANIFEST.json',import.meta.url),'utf8'));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const baseline=readFileSync(new URL('../BASELINE.md',import.meta.url),'utf8');

if(manifest.schema!==1)fail('Release manifest schema inválido');
if(!/^[a-f0-9]{40}$/.test(String(manifest.visualBaseline||'')))fail('Baseline visual inválida');
const currentBaseline=baseline.match(/## Baseline vigente[\s\S]*?`([a-f0-9]{40})`/)?.[1]||'';
if(currentBaseline!==manifest.visualBaseline)fail('BASELINE.md diverge da baseline do manifesto');
if(manifest.runtime?.node!=='24.21.0'||manifest.runtime?.npm!=='11.19.0')fail('Runtime do manifesto divergente');
if(pkg.engines?.node!==manifest.runtime.node)fail('package.json diverge do runtime do manifesto');
if(process.versions.node!==manifest.runtime.node)fail(`Node atual ${process.versions.node} != ${manifest.runtime.node}`);
const npmVersion=run('npm',['--version']);
if(npmVersion!==manifest.runtime.npm)fail(`npm atual ${npmVersion} != ${manifest.runtime.npm}`);

if(!Array.isArray(manifest.stages)||manifest.stages.length!==6)fail('Manifesto deve conter as seis etapas');
const head=run('git',['rev-parse','HEAD']);
let previous='';
for(const [index,stage] of manifest.stages.entries()){
  if(stage.step!==index+1||!Number.isInteger(stage.pr)||!/^[a-f0-9]{40}$/.test(stage.head))fail(`Etapa inválida no índice ${index}`);
  const exists=spawnSync('git',['cat-file','-e',stage.head+'^{commit}']);
  if(exists.status!==0)fail(`Commit da etapa ${stage.step} não existe no checkout: ${stage.head}`);
  const ancestor=spawnSync('git',['merge-base','--is-ancestor',stage.head,head]);
  if(ancestor.status!==0)fail(`HEAD não contém a etapa ${stage.step}: ${stage.head}`);
  if(previous){
    const ordered=spawnSync('git',['merge-base','--is-ancestor',previous,stage.head]);
    if(ordered.status!==0)fail(`Etapa ${stage.step} não descende da etapa anterior`);
  }
  previous=stage.head;
}

if(
  manifest.anchorPolicy?.authority!=='full-git-commit-sha'||
  manifest.anchorPolicy?.immutable!==true||
  manifest.anchorPolicy?.supersedeInsteadOfMove!==true||
  manifest.anchorPolicy?.sealAfter!=='release-approved'
){
  fail('Política de Release Anchor incompleta');
}

console.log(JSON.stringify({
  ok:true,
  head,
  visualBaseline:manifest.visualBaseline,
  stages:manifest.stages.map(stage=>({step:stage.step,pr:stage.pr,head:stage.head})),
  runtime:manifest.runtime
},null,2));
