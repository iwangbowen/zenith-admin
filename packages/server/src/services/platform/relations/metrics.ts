import { Counter, Histogram, register } from 'prom-client';
const duration = (register.getSingleMetric('zenith_entity_relation_duration_seconds') as Histogram | undefined) ?? new Histogram({ name: 'zenith_entity_relation_duration_seconds', help: 'Entity relation queries', labelNames: ['operation', 'status'], buckets: [0.025, 0.1, 0.3, 1, 3] });
const results = (register.getSingleMetric('zenith_entity_relation_requests_total') as Counter | undefined) ?? new Counter({ name: 'zenith_entity_relation_requests_total', help: 'Entity relation outcomes', labelNames: ['operation', 'status'] });
const summaryStates = (register.getSingleMetric('zenith_entity_relation_summary_states_total') as Counter | undefined) ?? new Counter({
  name: 'zenith_entity_relation_summary_states_total',
  help: 'Qualitative entity relation summary states',
  labelNames: ['source_type', 'relation_key', 'state'],
});
export function recordRelationMetric(operation: string, status: string, started: number): void {
  const labels = { operation, status };
  duration.observe(labels, (performance.now() - started) / 1000);
  results.inc(labels);
}

export function recordRelationSummaryState(sourceType: string, relationKey: string, state: string): void {
  summaryStates.inc({ source_type: sourceType, relation_key: relationKey, state });
}
