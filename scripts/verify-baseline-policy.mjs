import { readFileSync } from 'node:fs';
import { assertEvolutionPolicy, historicalDivergenceDecision } from './evolution-policy.mjs';

const manifest = JSON.parse(readFileSync(new URL('../RELEASE_MANIFEST.json', import.meta.url), 'utf8'));
assertEvolutionPolicy(manifest);

for (const identical of [true, false]) {
  const decision = historicalDivergenceDecision({ identical });
  if (decision.blocksEvolution !== false) throw new Error('Comparação histórica não pode bloquear evolução.');
  if (decision.requiresHistoricalPreservation !== false) throw new Error('Comparação histórica não pode exigir preservação.');
  if (decision.authority !== 'current-requirements-and-intentional-contracts') throw new Error('Autoridade de decisão incorreta.');
}

if (!/^[a-f0-9]{40}$/.test(String(manifest.visualComparisonSnapshot || ''))) {
  throw new Error('visualComparisonSnapshot deve ser apenas uma coordenada histórica válida.');
}

console.log('Evolution policy OK: estado corrente é base evolutiva; histórico é diagnóstico/rastreabilidade sem poder de veto.');
