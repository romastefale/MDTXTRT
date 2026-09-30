export const REQUIRED_EVOLUTION_POLICY = Object.freeze({
  model: 'current-state-is-evolution-base',
  temporalScope: 'permanent',
  everyProductStateRemainsMutable: true,
  anyAcceptedStateMayBeSuperseded: true,
  futureCertificationMayFreezeProduct: false,
  changePermissionDependsOnHistoricalState: false,
  evolutionPromotionMayBeBlockedByHistoricalState: false,
  authority: 'current-requirements-and-intentional-contracts',
  historicalStateAuthority: 'none',
  historicalBehaviorIsNormative: false,
  preservationByHistoricalParity: false,
  divergenceFromHistoricalStateFails: false,
  evolutionMayReplaceCurrentImplementation: true,
  acceptedEvolutionBecomesNextBase: true,
  releaseEvidenceRole: 'traceability-only',
  visualComparisonRole: 'optional-diagnostic-only'
});

export const REQUIRED_RELEASE_EVIDENCE_POLICY = Object.freeze({
  role: 'traceability-only',
  identity: 'exact-git-commit-sha',
  productStateRemainsMutable: true,
  preservationRequired: false,
  historicalBehaviorIsNormative: false,
  mayFreezeFutureEvolution: false,
  mayBlockEvolutionPromotion: false
});

export function assertEvolutionPolicy(manifest) {
  if (manifest?.schema !== 3) throw new Error('RELEASE_MANIFEST.json deve usar schema 3.');
  const actual = manifest?.evolutionPolicy;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error('evolutionPolicy ausente.');
  }
  const errors = [];
  for (const [key, expected] of Object.entries(REQUIRED_EVOLUTION_POLICY)) {
    if (actual[key] !== expected) errors.push(`evolutionPolicy.${key}: esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual[key])}`);
  }
  const unknown = Object.keys(actual).filter(key => !(key in REQUIRED_EVOLUTION_POLICY));
  if (unknown.length) errors.push('evolutionPolicy contém campos não reconhecidos: ' + unknown.join(', '));
  if (errors.length) throw new Error(errors.join('\n'));
  return actual;
}

export function historicalDivergenceDecision({ identical }) {
  return Object.freeze({
    identical: Boolean(identical),
    blocksEvolution: false,
    requiresHistoricalPreservation: false,
    authority: REQUIRED_EVOLUTION_POLICY.authority,
    meaning: identical ? 'comparison-match-only' : 'review-against-current-requirements'
  });
}


export function assertReleaseEvidencePolicy(manifest) {
  const actual = manifest?.releaseEvidencePolicy;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error('releaseEvidencePolicy ausente.');
  }
  const errors = [];
  for (const [key, expected] of Object.entries(REQUIRED_RELEASE_EVIDENCE_POLICY)) {
    if (actual[key] !== expected) errors.push(`releaseEvidencePolicy.${key}: esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual[key])}`);
  }
  const unknown = Object.keys(actual).filter(key => !(key in REQUIRED_RELEASE_EVIDENCE_POLICY));
  if (unknown.length) errors.push('releaseEvidencePolicy contém campos não reconhecidos: ' + unknown.join(', '));
  if (errors.length) throw new Error(errors.join('\n'));
  return actual;
}
