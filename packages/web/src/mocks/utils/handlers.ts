import { HttpResponse } from 'msw';

export function paginate<T>(list: T[], url: URL) {
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize };
}

export const ok = (data: unknown, message = 'ok') => HttpResponse.json({ code: 0, message, data });
export const notFound = (message = '不存在') => HttpResponse.json({ code: 404, message, data: null });
export const badRequest = (message: string) => HttpResponse.json({ code: 400, message, data: null });
