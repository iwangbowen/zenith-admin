import { vi } from 'vitest';

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * 以 JSON 响应队列替身 fetch：按调用顺序返回 responses（不足时复用最后一个），并记录每次调用的 url / 方法 / 头 / 体。
 */
export function stubFetch(responses: unknown[]): { calls: FetchCall[]; fetch: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string> | undefined) }, body });
    const payload = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetch: fetchMock };
}

/** 等待已入队的 microtask / promise 链跑完 */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function setMemberToken(token: string | null): void {
  if (token === null) localStorage.removeItem('zenith_member_token');
  else localStorage.setItem('zenith_member_token', token);
}

export function html(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}
