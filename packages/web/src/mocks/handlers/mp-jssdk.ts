import { http, HttpResponse } from 'msw';

export const mpJsSdkHandlers = [
  http.post('/api/mp/jssdk/config', async ({ request }) => {
    const body = await request.json() as { accountId: number; url: string };
    return HttpResponse.json({
      code: 0, message: 'ok',
      data: { appId: `wxmockapp${body.accountId}`, timestamp: Math.floor(Date.now() / 1000), nonceStr: Math.random().toString(36).slice(2, 12), signature: Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40) },
    });
  }),
];
