import { OpenAPIHono } from '@hono/zod-openapi';
import { memberAuthContract } from '@zenith/shared/member';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { authRateLimit, sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  registerMember,
  loginMember,
  refreshMemberToken,
  logoutMember,
  getMyMemberProfile,
  updateMyMemberProfile,
  changeMyMemberPassword,
  resetMemberPassword,
  deactivateMyAccount,
} from '../../services/member/member-auth.service';
import { sendMemberSmsCode } from '../../services/member/member-sms.service';
import { getClientInfo } from '../../lib/request-helpers';

const memberAuth = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;

const smsCodeRoute = defineContractRoute(memberAuthContract.smsCode, {
  middleware: [sensitiveRateLimit] as const,
  responses: {
    429: { content: jsonContent(ErrorResponse), description: '发送过于频繁' },
    502: { content: jsonContent(ErrorResponse), description: '短信发送失败' },
    503: { content: jsonContent(ErrorResponse), description: '短信服务未配置' },
  },
  handler: async (c) => {
    const { phone, scene } = c.req.valid('json');
    const r = await sendMemberSmsCode(phone, scene);
    return c.json(okBody({ sent: true, devCode: r.devCode }), 200);
  },
});

const registerRoute = defineContractRoute(memberAuthContract.register, {
  middleware: [sensitiveRateLimit] as const,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    const result = await registerMember({ ...c.req.valid('json'), ip, ua, source: 'web' });
    return c.json(okBody(result, '注册成功'), 200);
  },
});

const loginRoute = defineContractRoute(memberAuthContract.login, {
  middleware: [authRateLimit] as const,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    const result = await loginMember({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '登录成功'), 200);
  },
});

const refreshRoute = defineContractRoute(memberAuthContract.refresh, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await refreshMemberToken(c.req.valid('json').refreshToken)), 200),
});

const resetPasswordRoute = defineContractRoute(memberAuthContract.resetPassword, {
  middleware: [sensitiveRateLimit] as const,
  handler: async (c) => {
    await resetMemberPassword(c.req.valid('json'));
    return c.json(okBody(null, '密码已重置'), 200);
  },
});

const logoutRoute = defineContractRoute(memberAuthContract.logout, {
  middleware: member,
  handler: async (c) => {
    await logoutMember();
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

const meRoute = defineContractRoute(memberAuthContract.me, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyMemberProfile()), 200),
});

const profileRoute = defineContractRoute(memberAuthContract.updateProfile, {
  middleware: member,
  handler: async (c) => c.json(okBody(await updateMyMemberProfile(c.req.valid('json')), '资料已更新'), 200),
});

const passwordRoute = defineContractRoute(memberAuthContract.changePassword, {
  middleware: member,
  handler: async (c) => {
    await changeMyMemberPassword(c.req.valid('json'));
    return c.json(okBody(null, '密码已修改'), 200);
  },
});

const deactivateRoute = defineContractRoute(memberAuthContract.deactivate, {
  middleware: [memberAuthMiddleware, sensitiveRateLimit] as const,
  handler: async (c) => {
    await deactivateMyAccount(c.req.valid('json'));
    return c.json(okBody(null, '账户已注销'), 200);
  },
});

memberAuth.openapiRoutes([
  smsCodeRoute,
  registerRoute,
  loginRoute,
  refreshRoute,
  resetPasswordRoute,
  logoutRoute,
  meRoute,
  profileRoute,
  passwordRoute,
  deactivateRoute,
] as const);

export default memberAuth;
