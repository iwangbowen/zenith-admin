import { sql, type SQL } from 'drizzle-orm';
import { entityRelationSummaryStateSchema, type EntityRelationSummaryState } from '@zenith/shared/platform';
import { recordRelationSummaryMetric, recordRelationSummaryState } from './metrics';
import { isStatementTimeout, RelationBudgetExceeded, withRelationSummaryRead } from './runtime';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from './types';

type PreparedSummary = { provider: RelationProvider; expression: SQL<EntityRelationSummaryState> };
const BATCH_SIZE = 8;

function failureResult(error: unknown): 'timeout' | 'error' | 'budget' {
  return error instanceof RelationBudgetExceeded ? 'budget' : isStatementTimeout(error) ? 'timeout' : 'error';
}

async function executeBatch(prepared: readonly PreparedSummary[], access: RelationAccessContext) {
  const query = sql.join(prepared.map(({ provider, expression }) => sql`select ${provider.key}::text as key, ${expression} as state`), sql` union all `);
  const rows = await access.db.execute(query);
  const states = new Map(rows.map((row) => [String(row.key), entityRelationSummaryStateSchema.parse(row.state)]));
  if (prepared.some(({ provider }) => !states.has(provider.key))) throw new Error('Missing relation summary');
  return states;
}

/** Authorized groups only; operations sharing a connection are deliberately sequential. */
export async function summarizeRelationProviders(providers: readonly RelationProvider[], anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const states = new Map<string, EntityRelationSummaryState>();
  const prepared: PreparedSummary[] = [];
  const fallback: RelationProvider[] = [];
  for (const provider of providers) {
    const started = performance.now();
    try {
      if (provider.summaryQuery) {
        prepared.push({ provider, expression: provider.summaryQuery(anchor, { access }) });
        continue;
      }
      if (provider.prepareSummaryQuery) {
        const expression = await withRelationSummaryRead(access, (isolated) => provider.prepareSummaryQuery!(anchor, { access: isolated }));
        prepared.push({ provider, expression });
        continue;
      }
      fallback.push(provider);
    } catch (error) {
      states.set(provider.key, 'unavailable');
      recordRelationSummaryMetric(provider.sourceType, provider.key, failureResult(error), started);
    }
  }
  // Run cheap SQL batches before polymorphic scans can consume the request budget.
  for (let offset = 0; offset < prepared.length; offset += BATCH_SIZE) {
    const batch = prepared.slice(offset, offset + BATCH_SIZE);
    const started = performance.now();
    try {
      const batchStates = await withRelationSummaryRead(access, (isolated) => executeBatch(batch, isolated), 500);
      for (const { provider } of batch) {
        states.set(provider.key, batchStates.get(provider.key)!);
        recordRelationSummaryMetric(provider.sourceType, provider.key, 'success', started);
      }
    } catch (error) {
      // Roll back the failed batch before retrying each group in its own savepoint.
      for (const entry of batch) {
        recordRelationSummaryMetric(entry.provider.sourceType, entry.provider.key, failureResult(error), started);
        const retryStarted = performance.now();
        try {
          const single = await withRelationSummaryRead(access, (isolated) => executeBatch([entry], isolated));
          states.set(entry.provider.key, single.get(entry.provider.key)!);
          recordRelationSummaryMetric(entry.provider.sourceType, entry.provider.key, 'success', retryStarted);
        } catch (singleError) {
          states.set(entry.provider.key, 'unavailable');
          recordRelationSummaryMetric(entry.provider.sourceType, entry.provider.key, failureResult(singleError), retryStarted);
        }
      }
    }
  }
  for (const provider of fallback) {
    const started = performance.now();
    try {
      const state = await withRelationSummaryRead(access, async (isolated) => {
        if (provider.summarize) return entityRelationSummaryStateSchema.parse(await provider.summarize(anchor, { access: isolated }));
        if (provider.exists) return await provider.exists(anchor, { access: isolated }) ? 'has-data' : 'empty';
        // Polymorphic links still need per-target authorization; inspect a bounded page.
        const page = await provider.list(anchor, { limit: 1, access: isolated });
        return page.degraded ? 'unavailable' : page.items.some((item) => item.capabilities.view) ? 'has-data' : 'empty';
      });
      states.set(provider.key, state);
      recordRelationSummaryMetric(provider.sourceType, provider.key, state === 'unavailable' ? 'error' : 'success', started);
    } catch (error) {
      states.set(provider.key, 'unavailable');
      recordRelationSummaryMetric(provider.sourceType, provider.key, failureResult(error), started);
    }
  }
  return providers.map((provider) => {
    const summaryState = states.get(provider.key) ?? 'unavailable';
    recordRelationSummaryState(provider.sourceType, provider.key, summaryState);
    return { ...provider.descriptor, summaryState };
  });
}
