import type { ApiScope, RatePlan } from '../open-platform/contracts';
import { SEED_DATE } from './_base';

// ─── 开放平台：API Scope 注册表 ───────────────────────────────────────────────
const API_SCOPE_ROWS: Omit<ApiScope, 'usedByAppCount'>[] = [
  { id: 1, code: 'openid',         name: 'OpenID（身份）',   description: '确认用户身份（用户 ID）',   scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, code: 'profile',        name: 'Profile（资料）',  description: '读取基本信息（昵称、头像）', scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, code: 'email',          name: 'Email（邮箱）',    description: '读取邮箱地址',              scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, code: 'offline_access', name: '离线访问',         description: '允许在用户离线时续签令牌',   scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, code: 'user:read',      name: '读取用户',         description: '读取开放平台用户资源',       scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, code: 'data:read',      name: '读取数据',         description: '调用只读数据类接口',         scopeGroup: 'data',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, code: 'data:write',     name: '写入数据',         description: '调用写入/变更类接口',        scopeGroup: 'data',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, code: 'order:read',     name: '读取订单',         description: '读取订单数据',              scopeGroup: 'order',   status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, code: 'cms:read',       name: '读取 CMS 内容',    description: '读取 CMS 栏目与已发布内容（Headless API）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, code: 'cms:write',     name: '写入 CMS 内容',    description: '创建/更新 CMS 内容并提交审核（还需在站点「开放授权」中授权站点与栏目）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, code: 'cms:publish',   name: '发布 CMS 内容',    description: '绕过审核直接发布（还需授权开启「允许直接发布」且站点开启开关）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, code: 'rules:evaluate', name: '规则求值',         description: '调用规则中心统一求值（决策表/决策流/评分卡/名单，仅已发布资产）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, code: 'iot:read',      name: '读取 IoT 设备',    description: '读取 IoT 设备列表、详情与设备影子', scopeGroup: 'iot', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, code: 'iot:write',     name: '控制 IoT 设备',    description: '下发服务调用指令与期望属性', scopeGroup: 'iot', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, code: 'payment:intent:create', name: '创建支付意图', description: '通过开放支付 API 创建支付意图', scopeGroup: 'payment', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, code: 'payment:intent:read', name: '读取支付意图', description: '读取本应用支付意图与有效支付能力', scopeGroup: 'payment', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, code: 'payment:refund:create', name: '创建退款', description: '为本应用支付意图发起退款', scopeGroup: 'payment', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, code: 'payment:refund:read', name: '读取退款', description: '读取本应用退款状态', scopeGroup: 'payment', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, code: 'drive:read',     name: '读取网盘文件',     description: '读取被授权空间的目录与文件元数据、下载文件内容（还需在空间治理中授权空间）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, code: 'drive:write',    name: '写入网盘文件',     description: '向被授权空间上传文件（授权角色需为可编辑）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

/** 引用计数由服务端按应用配置实时统计；种子与 Demo 初始态均为未被引用 */
export const SEED_API_SCOPES: ApiScope[] = API_SCOPE_ROWS.map((row) => ({ ...row, usedByAppCount: 0 }));

// ─── 开放平台：限流套餐 ───────────────────────────────────────────────────────
export const SEED_RATE_PLANS: RatePlan[] = [
  { id: 1, code: 'free',       name: '免费版',   description: '默认套餐，适合接入调试',     qpsLimit: 5,   dailyQuota: 10000,    monthlyQuota: 200000,    isDefault: true,  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, code: 'pro',        name: '专业版',   description: '适合中小规模生产调用',       qpsLimit: 50,  dailyQuota: 500000,   monthlyQuota: 10000000,  isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, code: 'enterprise', name: '企业版',   description: '高并发，配额不限',           qpsLimit: 500, dailyQuota: 0,        monthlyQuota: 0,         isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
