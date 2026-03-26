import { http, HttpResponse } from 'msw';

const API = import.meta.env.VITE_API_BASE_URL || '';

export const oauthHandlers = [
  // 获取授权链接
  http.get(`${API}/api/auth/oauth/:provider`, ({ params }) => {
    const provider = params.provider as string;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        authUrl: `https://example.com/oauth/${provider}?demo=true`,
        state: 'mock-state-123',
      },
    });
  }),

  // OAuth 回调
  http.post(`${API}/api/auth/oauth/:provider/callback`, () => {
    return HttpResponse.json({
      code: 0,
      message: '演示模式：第三方登录暂不可用',
      data: { needBind: true, oauthInfo: { provider: 'github', openId: 'mock-123', nickname: 'DemoUser' } },
    });
  }),

  // 绑定
  http.post(`${API}/api/auth/oauth/bind`, () => {
    return HttpResponse.json({ code: 0, message: '绑定成功（演示）', data: null });
  }),

  // 解绑
  http.delete(`${API}/api/auth/oauth/unbind/:provider`, () => {
    return HttpResponse.json({ code: 0, message: '已解绑（演示）', data: null });
  }),

  // 账号列表
  http.get(`${API}/api/auth/oauth/accounts`, () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: [
        {
          id: 1,
          provider: 'github',
          openId: '12345678',
          nickname: 'demo-github-user',
          avatar: null,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
  }),
];
