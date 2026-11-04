import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectIdentityReadModel } from '../../test-utils/domain-read-models';

const root = fileURLToPath(new URL('../../', import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [join(directory, entry.name)] : []);
}
const workflow = [...files(join(root, 'services/workflow')), ...files(join(root, 'lib')).filter(file => relative(root, file).replaceAll('\\', '/').startsWith('lib/workflow'))];
describe('identity and workflow public boundaries', () => {
  it('keeps identity commands away from workflow storage and internal job machinery', () => {
    const violations = files(join(root, 'services/identity')).filter(file => /\b(?:workflowInstances|workflowTasks|workflowJobs)\b|from\s+['"][^'"]*workflow-jobs/.test(readFileSync(file, 'utf8')));
    expect(violations.map(file => relative(root, file))).toEqual([]);
  });
  it('allows only explicitly declared identity read models and rejects writes, including aliases', () => {
    const declared = JSON.parse(readFileSync(new URL('./public/identity-read-models.json', import.meta.url), 'utf8')) as Record<string, { purpose: string; tables: Record<string, string[]> }>;
    const actual: Record<string, Record<string, string[]>> = {};
    for (const file of workflow) {
      const model = inspectIdentityReadModel(readFileSync(file, 'utf8'));
      expect(model.writes, file).toEqual([]);
      if (Object.keys(model.tables).length) actual[relative(root, file).replaceAll('\\', '/')] = model.tables;
    }
    expect(actual).toEqual(Object.fromEntries(Object.entries(declared).map(([file, model]) => [file, model.tables])));
    expect(Object.values(declared).every(model => model.purpose.trim().length > 0)).toBe(true);
    expect(inspectIdentityReadModel("import { users as accounts } from '../../db/schema'; const target = alias(accounts, 't'); tx.update(target).set({ status: 'disabled' });").writes).toEqual(['update(users)']);
  });
  it('does not load concrete authority services or the bootstrap from workflow core', () => {
    for (const file of workflow) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/(?:from\s*|import\()\s*['"][^'"]*(?:bootstrap|identity\/(?:public\/)?access-)[^'"]*['"]/);
    }
  });
});
