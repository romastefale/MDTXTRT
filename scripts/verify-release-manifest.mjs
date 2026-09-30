import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { assertEvolutionPolicy } from './evolution-policy.mjs';

const fail=message=>{throw new Error(message);};
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
const manifest=JSON.parse(readFileSync(new URL('../RELEASE_MANIFEST.json',import.meta.url),'utf8'));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assertEvolutionPolicy(manifest);

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
  if(spawnSync('git',['cat-file','-e',stage.head+'^{commit}']).status!==0)fail(`Commit da etapa ${stage.step} não existe no checkout: ${stage.head}`);
  if(spawnSync('git',['merge-base','--is-ancestor',stage.head,head]).status!==0)fail(`HEAD não contém a etapa ${stage.step}: ${stage.head}`);
  if(previous&&spawnSync('git',['merge-base','--is-ancestor',previous,stage.head]).status!==0)fail(`Etapa ${stage.step} não descende da etapa anterior`);
  previous=stage.head;
}

console.log(JSON.stringify({ok:true,head,evolutionPolicy:manifest.evolutionPolicy,stages:manifest.stages.map(({step,pr,head})=>({step,pr,head})),runtime:manifest.runtime},null,2));
