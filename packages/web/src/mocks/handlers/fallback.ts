import { http } from 'msw';
import { fail } from '@/mocks/utils/handlers';
/**
 * 兜底 handler（必须注册在所有具体 handler 之后）。
 *
 * 背景：demo 模式下 MSW 配置 `onUnhandledRequest: 'bypass'`，未被任何 handler 命中的
 * `/api/*` 请求会被放行到网络层。在 `dev:demo`（本地带后端代理）场景下，这些请求会被
 * 代理到真实后端，后端不认 mock token → 返回 401 → `request.ts` 触发跳转登录页。
 *
 * 该兜底 handler 拦截所有未实现的 `/api/*` 请求，统一返回 HTTP 200 + `code:-1`，
 * 使页面走「接口错误」分支优雅降级（与已部署 demo 站点 404→code:-1 的行为一致），
 * 从根本上杜绝「切到未 mock 的页面就跳登录」的问题。
 */
export const fallbackHandlers = [
  http.all('/api/*', () =>
    fail(-1, '演示模式下该接口暂未提供模拟数据'),
  ),
];
