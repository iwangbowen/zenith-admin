import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('workflow engine durable outbox diagnostics', () => {
  it('reads workflow consumer receipts rather than webhook workflow jobs', async () => {
    const source = await readFile(new URL('./workflow-engine-introspection.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('.from(eventConsumerDeliveries)');
    expect(source).toContain("eq(eventOutbox.domain, 'workflow')");
    expect(source).toContain('eventConsumerDeliveries.finishedAt');
    expect(source).not.toContain("eq(workflowJobs.jobType, 'webhook_delivery')");
  });
});
