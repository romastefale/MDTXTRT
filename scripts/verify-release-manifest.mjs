import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

const historicalStages=manifest.historicalEvidence?.implementationStages;
if(!Array.isArray(historicalStages))fail('historicalEvidence.implementationStages deve ser uma lista de rastreabilidade');
for(const [index,stage] of historicalStages.entries()){
  if(stage.step!==index+1||!Number.isInteger(stage.pr)||!/^[a-f0-9]{40}$/.test(stage.head))fail(`Evidência histórica inválida no índice ${index}`);
}
if(manifest.releaseGates?.automated?.includes('stage-ancestry'))fail('stage-ancestry não pode ser gate automatizado');
const evidencePolicy=manifest.releaseEvidencePolicy;
if(evidencePolicy?.authority!=='historical-release-evidence-sha'||evidencePolicy?.immutableProductState!==false||evidencePolicy?.preservationRequired!==false||evidencePolicy?.historicalBehaviorIsNormative!==false)fail('releaseEvidencePolicy deve limitar SHAs históricos à rastreabilidade');

console.log(JSON.stringify({ok:true,head,evolutionPolicy:manifest.evolutionPolicy,historicalEvidence:{implementationStages:historicalStages.map(({step,pr,head})=>({step,pr,head}))},runtime:manifest.runtime},null,2));
