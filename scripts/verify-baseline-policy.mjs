import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('RELEASE_MANIFEST.json', root), 'utf8'));
const errors = [];
const policy = manifest.baselinePolicy;

if (manifest.schema !== 2) errors.push('RELEASE_MANIFEST.json deve usar schema 2.');
if (policy?.role !== 'evolutionary-reference') errors.push('baselinePolicy.role deve ser evolutionary-reference.');
if (policy?.immutable !== false) errors.push('baselinePolicy.immutable deve ser false.');
if (policy?.preservationRequired !== false) errors.push('baselinePolicy.preservationRequired deve ser false.');
if (policy?.historicalBehaviorIsNormative !== false) errors.push('baselinePolicy.historicalBehaviorIsNormative deve ser false.');
if (policy?.divergenceMeaning !== 'review-required-not-automatic-failure') errors.push('Divergência visual deve exigir revisão, não preservação automática.');
if (policy?.advanceWhen !== 'deliberate-change-accepted') errors.push('Snapshot de comparação deve poder avançar após mudança deliberada aceita.');
if (manifest.anchorPolicy?.immutable !== true) errors.push('Release Anchor deve continuar imutável e semanticamente separado.');

const required = {
  'README.md': ['estado corrente a partir do qual o produto continua evoluindo', 'esse sha não define a baseline'],
  'BASELINE.md': ['baseline = ponto de partida para evolução', 'nenhuma mudança solicitada deve ser rejeitada'],
  'AGENTS.md': ['no authoritative baseline sha', 'baseline cannot veto'],
  'RELEASE_VALIDATION.md': ['visual comparison snapshot', 'it is not normative product behavior'],
  'RELEASE_ANCHOR.md': ['replaceable visual-comparison snapshot', 'does not constrain later product evolution']
};
for (const [file, phrases] of Object.entries(required)) {
  const content = readFileSync(new URL(file, root), 'utf8').toLowerCase();
  for (const phrase of phrases) if (!content.includes(phrase)) errors.push(file + ' perdeu a semântica obrigatória: ' + phrase);
}

const forbidden = [
  ['README.md', /authoritative working baseline sha/i],
  ['AGENTS.md', /authoritative working baseline sha/i],
  ['RELEASE_ANCHOR.md', /approved visual baseline/i],
  ['RELEASE_VALIDATION.md', /normative visual baseline/i],
  ['ARCHITECTURE.md', /explicitly adopted visual reference/i]
];
for (const [file, pattern] of forbidden) {
  const content = readFileSync(new URL(file, root), 'utf8');
  if (pattern.test(content)) errors.push(file + ' reintroduziu linguagem de baseline congelada: ' + pattern);
}

if (errors.length) {
  console.error(errors.map(error => '- ' + error).join('\n'));
  process.exit(1);
}
console.log('Baseline contract OK: estado corrente evolutivo; SHA visual é apenas snapshot comparativo substituível.');
