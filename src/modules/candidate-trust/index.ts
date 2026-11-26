export * from './types.js';
export { TRUST_RULE_VERSION } from './constants.js';
export { IdentityIndex, identityKeys, workFingerprint } from './engine/identity-index.js';
export { evaluateCandidate } from './engine/run-checks.js';
export {
  buildFullIndex, buildLocalIndex, enrollCandidates, refreshStaleFingerprints, toTrustCandidate, type TrustTrigger,
} from './repository.js';
export { runTrustCheck, recheckTrackedCandidates, MAX_CHECK_BATCH, type TrustCheckSummary } from './service.js';
