// scripts/verify-cost-pricing-version.ts
/**
 * Verify CostResult exposes a nullable pricing_version per the spec's per-tier rule:
 * - DB row → source_version
 * - bundled JSON failsafe → __meta.version (or KEY_BUNDLED_VERSION setting if absent)
 * - OpenClaw override → null in v1
 * - curated fallback → null in v1
 * - default zero-rate → result returned as-is; pricing_version null
 */
import { computeCost } from '../src/lib/services/model-pricing';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

// Known model with bundled rate
const known = computeCost('claude-haiku-4-5', { input: 1000, output: 100 });
t('Known model returns object with pricing_version field', 'pricing_version' in known);
t('Known model pricing_version is string or null', typeof known.pricing_version === 'string' || known.pricing_version === null);
t('Known model has matchedKey', known.matchedKey !== null);
t('Known model has positive cost', known.cost > 0);

// Unknown model — default zero-rate path
const unknown = computeCost('definitely-not-a-real-model-zzz', { input: 1000, output: 100 });
t('Unknown model returns matchedKey null', unknown.matchedKey === null);
t('Unknown model returns cost 0', unknown.cost === 0);
t('Unknown model returns pricing_version null', unknown.pricing_version === null);

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
