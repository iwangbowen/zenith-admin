import { expect, it } from 'vitest';
import { selectExportRows } from './scope';

it('exports the intersection in source order without duplicating selected IDs', async () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }];
  const result = [];
  for await (const row of selectExportRows(rows, ['3', 2, 2])) result.push(row.id);
  expect(result).toEqual([2, 3]);
});

it('rejects a selection outside the authorized filtered source', async () => {
  const consume = async () => { for await (const row of selectExportRows([{ id: 1 }], [1, 2])) void row; };
  await expect(consume()).rejects.toMatchObject({ status: 400 });
});

it('checks cancellation during scanning even when no selected row has matched', async () => {
  let read = 0;
  async function* source() { for (let id = 1; id <= 1000; id++) { read++; yield { id }; } }
  const consume = async () => { for await (const row of selectExportRows(source(), [1000], async () => { throw new Error('cancelled'); })) void row; };
  await expect(consume()).rejects.toThrow('cancelled');
  expect(read).toBe(250);
});
