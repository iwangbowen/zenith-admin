import { describe, expect, it } from 'vitest';
import { MockHttpError } from './contract';
import { removeByIds, requireItem, updateItem } from './crud';

describe('mock crud helpers', () => {
  it('requires an item by id', async () => {
    const list = [{ id: 1, name: 'a' }];
    expect(requireItem(list, 1, '不存在')).toBe(list[0]);
    try {
      requireItem(list, 2, '不存在');
      throw new Error('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MockHttpError);
      expect(await ((error as MockHttpError).response.json())).toEqual({ code: 404, message: '不存在', data: null });
    }
  });

  it('updates in place and refreshes updatedAt when requested', () => {
    const list = [{ id: 1, name: 'a', updatedAt: 'old' }];
    expect(updateItem(list, 1, { name: 'b' }, { notFoundMessage: '不存在', now: () => 'now' })).toEqual({ id: 1, name: 'b', updatedAt: 'now' });
  });

  it('removes selected ids and keeps the array reference', () => {
    const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(removeByIds(list, [1, 3])).toBe(2);
    expect(list).toEqual([{ id: 2 }]);
  });
});
