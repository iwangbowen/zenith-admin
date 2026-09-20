import type { WorkflowFormField } from './types';

type Values = Record<string, unknown>;
const record = (value: unknown): Values => value && typeof value === 'object' && !Array.isArray(value) ? value as Values : {};

/** Traverse only declared file fields. Layout containers do not change the value path. */
export async function mapWorkflowFormAttachments(
  fields: WorkflowFormField[], values: Values,
  resolve: (value: unknown, field: WorkflowFormField, path: string, fieldKeys: string[]) => Promise<unknown>,
): Promise<Values> {
  async function walk(fields: WorkflowFormField[], source: Values, path: string[], parents: string[]): Promise<Values> {
    let out = { ...source };
    for (const field of fields) {
      const keys = [...parents, field.key];
      if (field.type === 'row') {
        for (const column of field.columns ?? []) out = await walk(column.fields, out, path, keys);
      } else if (field.type === 'tabs' || field.type === 'steps') {
        for (const pane of field.panes ?? []) out = await walk(pane.fields, out, path, keys);
      } else if (field.type === 'group') {
        out = await walk(field.children ?? [], out, path, keys);
      } else if (field.type === 'detail' && Array.isArray(out[field.key])) {
        const rows: unknown[] = [];
        for (const [index, row] of (out[field.key] as unknown[]).entries()) {
          rows.push(await walk(field.children ?? [], record(row), [...path, field.key, String(index)], keys));
        }
        out[field.key] = rows;
      } else if ((field.type === 'attachment' || field.type === 'image') && Object.hasOwn(out, field.key)) {
        out[field.key] = await resolve(out[field.key], field, JSON.stringify([...path, field.key]), keys);
      }
    }
    return out;
  }
  return walk(fields, values, [], []);
}
