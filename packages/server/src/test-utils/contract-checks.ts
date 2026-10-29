import { accessPermissions, accessPlatformOnly, type AnyOperation } from '@zenith/shared/core';
import type { RouteAccessFacts } from './route-facts';

/** The same gate comparison is used for domain apps and the complete application. */
export function accessMismatches(operations: readonly AnyOperation[], accessFacts: Map<string, RouteAccessFacts>) {
  let checked = 0;
  const violations: string[] = [];
  for (const op of operations) {
    if (op.security !== 'bearer') continue;
    const key = `${op.method.toUpperCase()} ${op.fullPath.replace(/\{([^}]+)\}/g, ':$1')}`;
    const fact = accessFacts.get(key);
    if (!fact) continue;
    checked++;
    const problems: string[] = [];
    if (!fact.auth) problems.push('missing authentication');
    const expected = [...accessPermissions(op.access)].sort();
    const actual = [...new Set(fact.permission ?? [])].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) problems.push(`permission ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    if (fact.platformOnly !== accessPlatformOnly(op.access)) problems.push('platform guard mismatch');
    if ((fact.audit?.description ?? null) !== (op.audit?.description ?? null)) problems.push('audit mismatch');
    if ((fact.feature ?? null) !== (op.feature ?? null)) problems.push('license feature mismatch');
    if (fact.gateCounts.auth > 1 || fact.gateCounts.platform > 1 || fact.gateCounts.guard > 1) problems.push('duplicate gate');
    if (problems.length) violations.push(`${key}: ${problems.join('; ')}`);
  }
  return { checked, violations };
}
