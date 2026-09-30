import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_EVOLUTION_POLICY, assertEvolutionPolicy, historicalDivergenceDecision } from '../scripts/evolution-policy.mjs';

const manifest = () => ({ schema: 3, evolutionPolicy: { ...REQUIRED_EVOLUTION_POLICY } });

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
