import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { REQUIRED_EVOLUTION_POLICY, REQUIRED_RELEASE_EVIDENCE_POLICY, assertEvolutionPolicy, assertReleaseEvidencePolicy, historicalDivergenceDecision } from '../scripts/evolution-policy.mjs';

const manifest = () => ({ schema: 3, evolutionPolicy: { ...REQUIRED_EVOLUTION_POLICY }, releaseEvidencePolicy: { ...REQUIRED_RELEASE_EVIDENCE_POLICY } });

test('canonical evolution policy permanently keeps every product state mutable and supersedable', () => {
  assert.deepEqual(assertEvolutionPolicy(manifest()), REQUIRED_EVOLUTION_POLICY);
});

for (const [field, unsafe] of [
  ['temporalScope', 'current-candidate-only'],
  ['everyProductStateRemainsMutable', false],
  ['anyAcceptedStateMayBeSuperseded', false],
  ['futureCertificationMayFreezeProduct', true],
  ['changePermissionDependsOnHistoricalState', true],
  ['evolutionPromotionMayBeBlockedByHistoricalState', true],
  ['historicalStateAuthority', 'normative'],
  ['historicalBehaviorIsNormative', true],
  ['preservationByHistoricalParity', true],
  ['divergenceFromHistoricalStateFails', true],
  ['evolutionMayReplaceCurrentImplementation', false],
  ['acceptedEvolutionBecomesNextBase', false],
  ['releaseEvidenceRole', 'authority'],
  ['visualComparisonRole', 'gate']
]) {
  test('rejects regressive evolution policy: ' + field, () => {
    const value = manifest();
    value.evolutionPolicy[field] = unsafe;
    assert.throws(() => assertEvolutionPolicy(value), new RegExp('evolutionPolicy\\.' + field));
  });
}

test('historical divergence never blocks evolution', () => {
  const decision = historicalDivergenceDecision({ identical: false });
  assert.equal(decision.blocksEvolution, false);
  assert.equal(decision.requiresHistoricalPreservation, false);
  assert.equal(decision.meaning, 'review-against-current-requirements');
});

test('historical equality never creates preservation authority', () => {
  const decision = historicalDivergenceDecision({ identical: true });
  assert.equal(decision.blocksEvolution, false);
  assert.equal(decision.requiresHistoricalPreservation, false);
  assert.equal(decision.meaning, 'comparison-match-only');
});


test('permanent mutability is not scoped to the current candidate', () => {
  const policy = assertEvolutionPolicy(manifest());
  assert.equal(policy.temporalScope, 'permanent');
  assert.equal(policy.everyProductStateRemainsMutable, true);
  assert.equal(policy.anyAcceptedStateMayBeSuperseded, true);
  assert.equal(policy.futureCertificationMayFreezeProduct, false);
  assert.equal(policy.changePermissionDependsOnHistoricalState, false);
  assert.equal(policy.evolutionPromotionMayBeBlockedByHistoricalState, false);
});


test('release evidence can never freeze or block a later evolution', () => {
  const value = manifest();
  assert.deepEqual(assertReleaseEvidencePolicy(value), REQUIRED_RELEASE_EVIDENCE_POLICY);
  for (const [field, unsafe] of [
    ['role', 'authority'],
    ['productStateRemainsMutable', false],
    ['preservationRequired', true],
    ['historicalBehaviorIsNormative', true],
    ['mayFreezeFutureEvolution', true],
    ['mayBlockEvolutionPromotion', true]
  ]) {
    const regressive = manifest();
    regressive.releaseEvidencePolicy[field] = unsafe;
    assert.throws(() => assertReleaseEvidencePolicy(regressive), new RegExp('releaseEvidencePolicy\\.' + field));
  }
});

test('repository contains no legacy freeze-policy tokens', () => {
  const root = new URL('../', import.meta.url);
  const allowedExtensions = new Set(['.js','.mjs','.jsx','.json','.md','.yml','.yaml','.html','.webmanifest']);
  const forbidden = [
    ['verify','baseline','policy'].join('-'),
    ['verify','visual','baseline'].join('-'),
    ['BASELINE','PRESERVATION','REQUIRED'].join('_'),
    ['VISUAL','COMPARISON','SHA'].join('_'),
    ['anchor','Policy'].join(''),
    ['baseline','Policy'].join(''),
    ['visual','Baseline'].join(''),
    ['stage','ancestry'].join('-'),
    ['final immutable Release','Anchor'].join(' '),
    ['Normative visual','baseline'].join(' '),
    ['approved visual','baseline'].join(' '),
    ['RELEASE','ANCHOR.md'].join('_'),
    ['Release','Anchor'].join(' ')
  ];
  const skip = new Set(['node_modules','.git','.historical-visual-comparison']);
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir,{withFileTypes:true})) {
      if (skip.has(entry.name)) continue;
      const path = join(dir,entry.name);
      if (entry.isDirectory()) walk(path);
      else if (allowedExtensions.has(extname(entry.name))) files.push(path);
    }
  };
  walk(new URL('../', import.meta.url).pathname);
  for (const file of files) {
    const text = readFileSync(file,'utf8');
    for (const token of forbidden) assert.equal(text.includes(token),false,`${file} reintroduziu token legado: ${token}`);
  }
});
