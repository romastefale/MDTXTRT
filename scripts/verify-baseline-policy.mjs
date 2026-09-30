import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../RELEASE_MANIFEST.json', import.meta.url), 'utf8'));
const policy = manifest.baselinePolicy;
const errors = [];

if (!policy) errors.push('RELEASE_MANIFEST.json deve declarar baselinePolicy.');
if (policy?.role !== 'evolutionary-reference') errors.push('baselinePolicy.role deve ser evolutionary-reference.');
if (policy?.immutable !== false) errors.push('baselinePolicy.immutable deve ser false.');
if (policy?.preservationRequired !== false) errors.push('baselinePolicy.preservationRequired deve ser false.');
if (policy?.historicalBehaviorIsNormative !== false) errors.push('baselinePolicy.historicalBehaviorIsNormative deve ser false.');
if (policy?.divergenceMeaning !== 'review-required-not-automatic-failure') errors.push('Divergência deve exigir revisão, não falha automática.');
if (policy?.advanceWhen !== 'deliberate-change-accepted') errors.push('A baseline deve avançar quando mudança deliberada for aceita.');
if (manifest.anchorPolicy?.immutable !== true) errors.push('Release Anchor deve continuar imutável e separado da baseline evolutiva.');

for (const [file, required] of [
  ['README.md', ['ponto de partida evolutivo', 'não é uma base imutável']],
  ['BASELINE.md', ['base de evolução', 'não é uma especificação imutável']],
  ['AGENTS.md', ['replaceable evolutionary starting point', 'baseline cannot veto']]
]) {
  const content = readFileSync(new URL('../' + file, import.meta.url), 'utf8').toLowerCase();
  for (const phrase of required) {
    if (!content.includes(phrase.toLowerCase())) errors.push(file + ' não contém regra obrigatória: ' + phrase);
  }
}

if (errors.length) {
  console.error(errors.map(error => '- ' + error).join('\n'));
  process.exit(1);
}
console.log('Baseline policy OK: referência evolutiva, substituível e não normativa por mera existência histórica.');
