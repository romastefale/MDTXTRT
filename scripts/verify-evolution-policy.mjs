import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertEvolutionPolicy,
  assertReleaseEvidencePolicy,
  historicalDivergenceDecision,
  LEGACY_FREEZE_MARKERS,
  LEGACY_FREEZE_EXECUTABLE_PATTERN
} from './evolution-policy.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'RELEASE_MANIFEST.json'),'utf8'));
assertEvolutionPolicy(manifest);
assertReleaseEvidencePolicy(manifest);

for(const identical of [true,false]){
  const decision=historicalDivergenceDecision({identical});
  if(decision.blocksEvolution!==false)throw new Error('Comparação histórica não pode bloquear evolução.');
  if(decision.requiresHistoricalPreservation!==false)throw new Error('Comparação histórica não pode exigir preservação.');
  if(decision.authority!=='current-requirements-and-intentional-contracts')throw new Error('Autoridade de decisão incorreta.');
}

const binaryExtensions=new Set(['.jpg','.jpeg','.png','.gif','.webp','.ico','.zip','.pdf','.woff','.woff2','.ttf']);
const skip=new Set(['node_modules','.git','.historical-visual-comparison']);
const files=[];
const walk=dir=>{
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    if(skip.has(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory())walk(path);
    else if(entry.isFile()&&!binaryExtensions.has(extname(entry.name).toLowerCase()))files.push(path);
  }
};
walk(root);

for(const file of files){
  const text=readFileSync(file,'utf8');
  for(const marker of LEGACY_FREEZE_MARKERS){
    if(text.includes(marker))throw new Error(`Marcador legado de congelamento em ${file}: ${marker}`);
  }
  if(LEGACY_FREEZE_EXECUTABLE_PATTERN.test(text))throw new Error('Gate executável por ancestralidade histórica em '+file);
}

console.log('Permanent evolution policy OK: todo estado permanece mutável, substituível e promovível; histórico é apenas rastreabilidade/diagnóstico.');
