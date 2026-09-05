import type { MpKfRoutingStrategy, MpKfSessionCloseReason, MpKfSessionEventType, MpKfSessionStatus, MpMenuStatus } from '../mp/constants';
import type { MpAccount, MpAutoReply, MpBroadcast, MpDraft, MpFan, MpKfAccount, MpMaterial, MpMenu, MpMessage, MpMessageTemplate, MpQrcode, MpTag } from '../mp/contracts';
import type { MpMenuButton } from '../mp/types';
import type { MpMenuMatchRule } from '../mp/validation';
import { SEED_DATE } from './_base';

// ─── 公众号账号（示例占位，需填实际凭证后启用）──────────────────────────────────
export const SEED_MP_ACCOUNTS: MpAccount[] = [
  { id: 1, name: '示例服务号', account: 'gh_demo_service', appId: 'wxdemoservice0001', appSecret: 'DemoAppSecretReplaceMe', token: 'zenithdemotoken', encodingAesKey: null, encryptMode: 'plaintext', type: 'service', qrCodeUrl: null, isDefault: true,  autoCreateMember: false, contentCheckEnabled: false, status: 'disabled', remark: '初始占位配置，需填实际 AppSecret 后启用', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '示例测试号', account: null,              appId: 'wxdemotest00000001', appSecret: 'DemoTestSecret',        token: 'zenithtesttoken', encodingAesKey: null, encryptMode: 'plaintext', type: 'test',    qrCodeUrl: null, isDefault: false, autoCreateMember: false, contentCheckEnabled: false, status: 'disabled', remark: '微信测试号占位',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号标签（示例）────────────────────────────────────────────────────────
export const SEED_MP_TAGS: MpTag[] = [
  { id: 1, accountId: 1, wechatTagId: 100, name: '星标用户', fansCount: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, wechatTagId: 101, name: '活跃粉丝', fansCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, wechatTagId: null, name: '潜在客户', fansCount: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号粉丝（示例）────────────────────────────────────────────────────────
export const SEED_MP_FANS: MpFan[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', nickname: '小明', avatar: null, sex: 1, country: '中国', province: '广东', city: '深圳', language: 'zh_CN', subscribe: 'subscribed',   subscribeTime: SEED_DATE, remark: 'VIP客户', tagIds: [1, 2], unionid: null, memberId: null, blacklisted: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000002', nickname: '小红', avatar: null, sex: 2, country: '中国', province: '浙江', city: '杭州', language: 'zh_CN', subscribe: 'subscribed',   subscribeTime: SEED_DATE, remark: null,    tagIds: [1],    unionid: null, memberId: null, blacklisted: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000003', nickname: '老王', avatar: null, sex: 1, country: '中国', province: '北京', city: '北京', language: 'zh_CN', subscribe: 'unsubscribed', subscribeTime: SEED_DATE, remark: null,    tagIds: [],     unionid: null, memberId: null, blacklisted: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号消息（示例会话）──────────────────────────────────────────────────────
export const SEED_MP_MESSAGES: MpMessage[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'in',  msgType: 'event', content: 'subscribe',                 mediaId: null, mediaUrl: null, event: 'subscribe', msgId: null,   status: 'received', errorMsg: null, createdAt: '2025-03-01 10:00:00' },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'in',  msgType: 'text',  content: '你好，请问怎么开通会员？',   mediaId: null, mediaUrl: null, event: null,        msgId: '2001', status: 'received', errorMsg: null, createdAt: '2025-03-01 10:01:00' },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'out', msgType: 'text',  content: '您好！点击底部菜单「会员中心」即可开通～', mediaId: null, mediaUrl: null, event: null, msgId: null, status: 'sent', errorMsg: null, createdAt: '2025-03-01 10:02:00' },
  { id: 4, accountId: 1, openid: 'oDemoFan0000000000000002', direction: 'in',  msgType: 'text',  content: '最近有优惠券吗？',           mediaId: null, mediaUrl: null, event: null,        msgId: '2002', status: 'received', errorMsg: null, createdAt: '2025-03-02 09:00:00' },
];

// ─── 公众号自动回复（示例）──────────────────────────────────────────────────────
export const SEED_MP_AUTO_REPLIES: MpAutoReply[] = [
  { id: 1, accountId: 1, replyType: 'subscribe', keyword: null,     matchType: 'contain', contentType: 'text', content: '欢迎关注 Zenith 公众号！回复「会员」了解会员权益。', mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, replyType: 'keyword',   keyword: '会员',   matchType: 'contain', contentType: 'text', content: '点击底部菜单「会员中心」即可开通会员～',           mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, replyType: 'keyword',   keyword: '优惠券', matchType: 'contain', contentType: 'news', content: null, mediaId: null, newsArticles: [{ title: '最新优惠券领取攻略', description: '点击查看本月可领取的优惠券与使用规则', picUrl: 'https://mmbiz.qpic.cn/demo/coupon.png', url: 'https://example.com/coupons' }], transferToKf: false, status: 'enabled', sort: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, accountId: 1, replyType: 'keyword',   keyword: '人工',   matchType: 'contain', contentType: 'text', content: '正在为您转接人工客服，请稍候～',                     mediaId: null, newsArticles: null, transferToKf: true,  status: 'enabled', sort: 3, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, accountId: 1, replyType: 'default',   keyword: null,     matchType: 'contain', contentType: 'text', content: '感谢留言，我们会尽快回复您～',                       mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号自定义菜单（示例草稿）────────────────────────────────────────────────
export const SEED_MP_MENUS: MpMenu[] = [
  {
    id: 1, accountId: 1, status: 'draft', publishedAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    buttons: [
      { name: '会员中心', sub_button: [
        { name: '我的会员', type: 'view', url: 'https://example.com/member' },
        { name: '积分商城', type: 'view', url: 'https://example.com/points' },
      ] },
      { name: '最新活动', type: 'click', key: 'LATEST_EVENT' },
      { name: '联系我们', type: 'view', url: 'https://example.com/contact' },
    ],
  },
];

// ─── 公众号素材（示例）──────────────────────────────────────────────────────────
export const SEED_MP_MATERIALS: MpMaterial[] = [
  { id: 1, accountId: 1, type: 'image', name: '会员海报', wechatMediaId: 'demo_media_001', url: 'https://picsum.photos/seed/mp1/400/300', fileSize: 102400, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, type: 'image', name: '活动banner', wechatMediaId: null, url: 'https://picsum.photos/seed/mp2/400/300', fileSize: 88500, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, type: 'thumb', name: '图文封面缩略图', wechatMediaId: 'demo_thumb_001', url: 'https://picsum.photos/seed/mp3/200/200', fileSize: 35200, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号图文草稿（示例）──────────────────────────────────────────────────────
export const SEED_MP_DRAFTS: MpDraft[] = [
  {
    id: 1, accountId: 1, title: '会员权益全新升级', wechatMediaId: null, status: 'draft', createdAt: SEED_DATE, updatedAt: SEED_DATE,
    articles: [
      { title: '会员权益全新升级', author: '运营团队', digest: '更多积分、更多优惠等你来', content: '<p>尊敬的会员，本月起会员权益全面升级……</p>', thumbUrl: 'https://picsum.photos/seed/mp3/200/200', showCoverPic: true },
    ],
  },
];

// ─── 公众号模板消息模板（示例）──────────────────────────────────────────────────
export const SEED_MP_MESSAGE_TEMPLATES: MpMessageTemplate[] = [
  { id: 1, accountId: 1, templateId: 'DEMO_TPL_ORDER_PAID', title: '订单支付成功通知', content: '您的订单已支付成功\n订单号：{{order_no.DATA}}\n金额：{{amount.DATA}}', example: '您的订单已支付成功\n订单号：202603230001\n金额：￥99.00', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, templateId: 'DEMO_TPL_POINTS', title: '积分变动通知', content: '您的积分有变动\n变动：{{change.DATA}}\n余额：{{balance.DATA}}', example: '您的积分有变动\n变动：+100\n余额：1200', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号群发消息（示例）────────────────────────────────────────────────────
export const SEED_MP_BROADCASTS: MpBroadcast[] = [
  { id: 1, accountId: 1, msgType: 'text', target: 'all', tagId: null, content: '【Zenith 周报】本周上新会员权益，点击菜单「会员中心」查看详情～', mediaId: null, status: 'draft', wechatMsgId: null, scheduledAt: null, errorMsg: null, sentAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, msgType: 'text', target: 'tag', tagId: 1, content: '尊敬的星标用户，您有一张专属优惠券待领取！', mediaId: null, status: 'draft', wechatMsgId: null, scheduledAt: null, errorMsg: null, sentAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号带参数二维码（示例）─────────────────────────────────────────────────
export const SEED_MP_QRCODES: MpQrcode[] = [
  { id: 1, accountId: 1, type: 'permanent', sceneStr: 'channel_offline_store', name: '线下门店物料', ticket: 'DEMO_TICKET_OFFLINE', url: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=DEMO_TICKET_OFFLINE', expireSeconds: null, scanCount: 128, rewardPoints: 0, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, type: 'permanent', sceneStr: 'event_2026_spring', name: '春季活动推广', ticket: 'DEMO_TICKET_SPRING', url: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=DEMO_TICKET_SPRING', expireSeconds: null, scanCount: 36, rewardPoints: 50, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号多客服账号（示例）───────────────────────────────────────────────────
export const SEED_MP_KF_ACCOUNTS: MpKfAccount[] = [
  { id: 1, accountId: 1, kfAccount: 'kf2001@gh_demo_service', nickname: '客服小柒', avatar: null, kfId: '1001', inviteStatus: 'bound', inviteWx: 'zenith_cs_01', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, kfAccount: 'kf2002@gh_demo_service', nickname: '客服小满', avatar: null, kfId: '1002', inviteStatus: 'inviting', inviteWx: null, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 多客服会话治理（路由配置 + 会话状态机 + 事件流水）──────────────────────────
export interface SeedMpKfRoutingConfig {
  accountId: number;
  enabled: boolean;
  strategy: MpKfRoutingStrategy;
  maxConcurrent: number;
  waitTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  autoCloseEnabled: boolean;
  welcomeText: string | null;
}

export const SEED_MP_KF_ROUTING_CONFIGS: SeedMpKfRoutingConfig[] = [
  { accountId: 1, enabled: true, strategy: 'least_active', maxConcurrent: 5, waitTimeoutMinutes: 3, idleTimeoutMinutes: 15, autoCloseEnabled: true, welcomeText: '您好，很高兴为您服务，请问有什么可以帮您？' },
];

export interface SeedMpKfSession {
  id: number;
  accountId: number;
  openid: string;
  kfId: number | null;
  status: MpKfSessionStatus;
  unreadCount: number;
  source: string;
  closeReason: MpKfSessionCloseReason | null;
}

export const SEED_MP_KF_SESSIONS: SeedMpKfSession[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', kfId: 1, status: 'active', unreadCount: 0, source: 'text', closeReason: null },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000002', kfId: null, status: 'waiting', unreadCount: 1, source: 'text', closeReason: null },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000003', kfId: 2, status: 'closed', unreadCount: 0, source: 'text', closeReason: 'manual' },
];

export interface SeedMpKfSessionEvent {
  id: number;
  sessionId: number;
  accountId: number;
  type: MpKfSessionEventType;
  fromKfId: number | null;
  toKfId: number | null;
  detail: string;
}

export const SEED_MP_KF_SESSION_EVENTS: SeedMpKfSessionEvent[] = [
  { id: 1, sessionId: 1, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 2, sessionId: 1, accountId: 1, type: 'assign', fromKfId: null, toKfId: 1, detail: '系统自动分配' },
  { id: 3, sessionId: 2, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 4, sessionId: 3, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 5, sessionId: 3, accountId: 1, type: 'accept', fromKfId: null, toKfId: 2, detail: '人工接入' },
  { id: 6, sessionId: 3, accountId: 1, type: 'close', fromKfId: 2, toKfId: null, detail: '手动结束' },
];

// ─── 个性化菜单（示例）────────────────────────────────────────────────────────
export interface SeedMpConditionalMenu {
  id: number;
  accountId: number;
  name: string;
  buttons: MpMenuButton[];
  matchRule: MpMenuMatchRule;
  status: MpMenuStatus;
}

export const SEED_MP_CONDITIONAL_MENUS: SeedMpConditionalMenu[] = [
  {
    id: 1, accountId: 1, name: '女性用户菜单', status: 'draft',
    matchRule: { sex: '2' },
    buttons: [
      { name: '美妆专区', type: 'view', url: 'https://example.com/beauty' },
      { name: '会员中心', type: 'click', key: 'MEMBER_CENTER' },
    ],
  },
  {
    id: 2, accountId: 1, name: '星标用户菜单', status: 'draft',
    matchRule: { tagId: '100' },
    buttons: [
      { name: '专属客服', type: 'click', key: 'VIP_KF' },
      {
        name: '更多', type: '', sub_button: [
          { name: '官网', type: 'view', url: 'https://example.com' },
          { name: '积分商城', type: 'view', url: 'https://example.com/points' },
        ],
      },
    ],
  },
];
