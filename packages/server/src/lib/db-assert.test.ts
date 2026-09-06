import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { requireFirstRow, requireRow } from './db-assert';

describe('requireRow / requireFirstRow', () => {
  it('存在则原样返回', () => {
    const row = { id: 1 };
    expect(requireRow(row, '不存在')).toBe(row);
  });

  it('null / undefined 抛 404，文案透传，状态可覆盖', () => {
    expect(() => requireRow(undefined, '标签不存在')).toThrowError(HTTPException);
    try {
      requireRow(null, '无权访问', 403);
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(403);
      expect((err as HTTPException).message).toBe('无权访问');
    }
  });

  it('requireFirstRow 取查询结果首行', async () => {
    await expect(requireFirstRow(Promise.resolve([{ id: 9 }, { id: 10 }]), 'x')).resolves.toEqual({ id: 9 });
    await expect(requireFirstRow(Promise.resolve([]), '地区不存在')).rejects.toMatchObject({ status: 404, message: '地区不存在' });
    await expect(requireFirstRow([{ id: 1 }], 'x')).resolves.toEqual({ id: 1 });
  });
});
