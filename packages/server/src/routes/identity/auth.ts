import { OpenAPIHono } from '@hono/zod-openapi';
import { authContract } from '@zenith/shared/identity';
import { authMiddleware } from '../../middleware/auth';
import { authRateLimit, captchaRateLimit, sensitiveRateLimit } from '../../middleware/rate-limit';
import { generateCaptcha, resolveCaptchaComplexity } from '../../lib/captcha';
import { getSettings } from '../../lib/settings';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  login, register, refreshAccessToken, logoutSession, logoutByRefreshToken,
  getMyProfile, updateMyProfile, changeMyPassword, verifyMyPassword,
  listMyLoginLogs, listMyOperationLogs, listMySessions, deleteMyOtherSessions, deleteMySession,
  switchTenantView, listSwitchableTenants, forgotPassword, resetPassword,
  getMyPreferences, saveMyPreferences, getMyFavoriteMenus, saveMyFavoriteMenus,
  verifyMfaLogin,
} from '../../services/identity/auth.service';
import { getClientInfo } from '../../lib/request-helpers';
import {
  beginTotpSetup,
  deleteMyMfaFactor,
  disableMyMfaFactor,
  listMyMfaFactors,
  listMyTrustedDevices,
  removeMyTrustedDevice,
  verifyTotpSetup,
} from '../../services/identity/identity-security.service';

const auth = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

const captchaRoute = defineContractRoute(authContract.captcha, {
  middleware: [captchaRateLimit] as const,
  handler: async (c) => {
    const { captchaEnabled, captchaComplexity } = await getSettings('auth');
    if (!captchaEnabled) return c.json(okBody({ enabled: false, captchaId: '', svg: '' }), 200);
    const result = generateCaptcha(resolveCaptchaComplexity(captchaComplexity));
    return c.json(okBody({ enabled: true, captchaId: result.captchaId, svg: result.captchaImage }), 200);
  },
});

const loginRoute = defineContractRoute(authContract.login, {
  middleware: [authRateLimit] as const,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    const result = await login({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '登录成功'), 200);
  },
});

const registerRoute = defineContractRoute(authContract.register, {
  middleware: [sensitiveRateLimit] as const,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    const result = await register({ ...c.req.valid('json'), ip, ua });
    return c.json(okBody(result, '注册成功'), 200);
  },
});

const refreshRoute = defineContractRoute(authContract.refresh, {
  middleware: [] as const,
  handler: async (c) => {
    const { refreshToken } = c.req.valid('json');
    const { ip, ua } = getClientInfo(c);
    return c.json(okBody(await refreshAccessToken(refreshToken, { ip, ua })), 200);
  },
});

const mfaVerifyRoute = defineContractRoute(authContract.mfaVerify, {
  middleware: [authRateLimit] as const,
  handler: async (c) => {
    const { challengeId, code, rememberDevice } = c.req.valid('json');
    const result = await verifyMfaLogin(challengeId, code, rememberDevice);
    return c.json(okBody(result, '登录成功'), 200);
  },
});

const logoutRoute = defineContractRoute(authContract.logout, {
  middleware: authed,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    await logoutSession({ ip, ua });
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

const logoutByRefreshRoute = defineContractRoute(authContract.logoutByRefresh, {
  middleware: [authRateLimit] as const,
  handler: async (c) => {
    const { ip, ua } = getClientInfo(c);
    await logoutByRefreshToken(c.req.valid('json').refreshToken, { ip, ua });
    return c.json(okBody(null, '已退出登录'), 200);
  },
});

const meRoute = defineContractRoute(authContract.me, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await getMyProfile()), 200),
});

const profileRoute = defineContractRoute(authContract.updateProfile, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await updateMyProfile(c.req.valid('json')), '资料已更新'), 200),
});

const passwordRoute = defineContractRoute(authContract.changePassword, {
  middleware: authed,
  handler: async (c) => {
    const { oldPassword, newPassword } = c.req.valid('json');
    await changeMyPassword(oldPassword, newPassword);
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

const myLoginLogsRoute = defineContractRoute(authContract.myLoginLogs, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMyLoginLogs(c.req.valid('query'))), 200),
});

const myOperationLogsRoute = defineContractRoute(authContract.myOperationLogs, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMyOperationLogs(c.req.valid('query'))), 200),
});

const mySessionsRoute = defineContractRoute(authContract.mySessions, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMySessions()), 200),
});

const deleteOtherSessionsRoute = defineContractRoute(authContract.deleteOtherSessions, {
  middleware: authed,
  handler: async (c) => {
    const count = await deleteMyOtherSessions();
    return c.json(okBody({ count }, `已退出 ${count} 个其他设备`), 200);
  },
});

const deleteSessionRoute = defineContractRoute(authContract.deleteSession, {
  middleware: authed,
  handler: async (c) => {
    await deleteMySession(c.req.valid('param').tokenId);
    return c.json(okBody(null, '已退出该设备'), 200);
  },
});

const switchTenantRoute = defineContractRoute(authContract.switchTenant, {
  middleware: authed,
  handler: async (c) => {
    const { tenantId } = c.req.valid('json');
    const { ip, ua } = getClientInfo(c);
    const { message, ...data } = await switchTenantView(tenantId, ip, ua);
    return c.json(okBody(data, message), 200);
  },
});

const authTenantsRoute = defineContractRoute(authContract.tenants, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listSwitchableTenants()), 200),
});

const forgotPasswordRoute = defineContractRoute(authContract.forgotPassword, {
  middleware: [sensitiveRateLimit] as const,
  handler: async (c) => {
    await forgotPassword(c.req.valid('json').email);
    return c.json(okBody(null, '如邮箱已注册，重置链接已发送至您的邮箱'), 200);
  },
});

const resetPasswordRoute = defineContractRoute(authContract.resetPassword, {
  middleware: [sensitiveRateLimit] as const,
  handler: async (c) => {
    const { token, newPassword } = c.req.valid('json');
    await resetPassword(token, newPassword);
    return c.json(okBody(null, '密码已重置，请使用新密码登录'), 200);
  },
});

const getPreferencesRoute = defineContractRoute(authContract.preferences, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await getMyPreferences()), 200),
});

const savePreferencesRoute = defineContractRoute(authContract.savePreferences, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await saveMyPreferences(c.req.valid('json'))), 200),
});

const getFavoriteMenusRoute = defineContractRoute(authContract.favoriteMenus, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await getMyFavoriteMenus()), 200),
});

const saveFavoriteMenusRoute = defineContractRoute(authContract.saveFavoriteMenus, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await saveMyFavoriteMenus(c.req.valid('json').menuIds)), 200),
});

const verifyPasswordRoute = defineContractRoute(authContract.verifyPassword, {
  middleware: authed,
  handler: async (c) => {
    await verifyMyPassword(c.req.valid('json').password);
    return c.json(okBody(null, '验证通过'), 200);
  },
});

const myMfaFactorsRoute = defineContractRoute(authContract.mfaFactors, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMyMfaFactors()), 200),
});

const beginTotpSetupRoute = defineContractRoute(authContract.beginTotpSetup, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await beginTotpSetup()), 200),
});

const verifyTotpSetupRoute = defineContractRoute(authContract.verifyTotpSetup, {
  middleware: authed,
  handler: async (c) => {
    const { factorId, code } = c.req.valid('json');
    await verifyTotpSetup(factorId, code);
    return c.json(okBody(null, '绑定成功'), 200);
  },
});

const disableMfaFactorRoute = defineContractRoute(authContract.disableMfaFactor, {
  middleware: authed,
  handler: async (c) => {
    await disableMyMfaFactor(c.req.valid('param').id);
    return c.json(okBody(null, '已停用'), 200);
  },
});

const deleteMfaFactorRoute = defineContractRoute(authContract.deleteMfaFactor, {
  middleware: authed,
  handler: async (c) => {
    await deleteMyMfaFactor(c.req.valid('param').id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const myTrustedDevicesRoute = defineContractRoute(authContract.trustedDevices, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMyTrustedDevices()), 200),
});

const deleteTrustedDeviceRoute = defineContractRoute(authContract.removeTrustedDevice, {
  middleware: authed,
  handler: async (c) => {
    await removeMyTrustedDevice(c.req.valid('param').id);
    return c.json(okBody(null, '已移除'), 200);
  },
});

// /my-sessions/others 先于 /my-sessions/{tokenId} 注册，否则 "others" 会被当成 tokenId
auth.openapiRoutes([captchaRoute, loginRoute, registerRoute, refreshRoute, mfaVerifyRoute, logoutRoute, logoutByRefreshRoute, meRoute, profileRoute, passwordRoute, myLoginLogsRoute, myOperationLogsRoute, mySessionsRoute, deleteOtherSessionsRoute, deleteSessionRoute, switchTenantRoute, authTenantsRoute, forgotPasswordRoute, resetPasswordRoute, getPreferencesRoute, savePreferencesRoute, getFavoriteMenusRoute, saveFavoriteMenusRoute, verifyPasswordRoute, myMfaFactorsRoute, beginTotpSetupRoute, verifyTotpSetupRoute, disableMfaFactorRoute, deleteMfaFactorRoute, myTrustedDevicesRoute, deleteTrustedDeviceRoute] as const);

export default auth;
