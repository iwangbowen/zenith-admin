import { defineConfig } from 'vitepress';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgPagesRepo = repositoryName.endsWith('.github.io');
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true' && repositoryName.length > 0;

let base = '/';

if (isGitHubPagesBuild) {
  base = isUserOrOrgPagesRepo ? '/' : `/${repositoryName}/`;
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'Zenith Admin',
  description: 'Zenith Admin 文档站：项目介绍、快速开始、开发说明与更新记录。',
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: 'Zenith Admin',
    logo: '/favicon.svg',
    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      },
    },
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '产品', link: '/product/overview' },
      {
        text: '开发',
        items: [
          { text: '后端 API 规范', link: '/backend/api-conventions' },
          { text: '前端 UI 规范', link: '/frontend/ui-conventions' },
          { text: 'AI 辅助开发', link: '/ai/' },
        ],
      },
      {
        text: '业务模块',
        items: [
          { text: '权限与组织', link: '/iam/' },
          { text: '即时通讯', link: '/chat/' },
          { text: '会员中心', link: '/member/' },
          { text: '通知中心', link: '/notification/' },
          { text: '文件与存储', link: '/storage/' },
          { text: 'AI 能力', link: '/ai-platform/' },
          { text: '工作流', link: '/workflow/' },
          { text: '支付中心', link: '/payment/' },
          { text: '数据分析', link: '/analytics/' },
        ],
      },
      {
        text: '运维与安全',
        items: [
          { text: '系统运维', link: '/ops/' },
          { text: '安全体系', link: '/backend/security' },
          { text: '定时任务', link: '/backend/cron-jobs' },
          { text: '多租户指南', link: '/backend/multi-tenant' },
        ],
      },
      { text: 'Changelog', link: '/changelog/' },
    ],
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/iwangbowen/zenith-admin' },
    ],
    footer: {
      message: 'Built with VitePress for local documentation preview.',
      copyright: 'Copyright © 2026 Zenith Admin',
    },
    sidebar: [
      {
        text: '开始使用',
        collapsed: false,
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '本地开发', link: '/guide/development' },
          { text: '项目结构', link: '/guide/project-structure' },
          { text: '部署说明', link: '/guide/deployment' },
          { text: 'Docker 部署', link: '/guide/docker' },
          { text: 'PWA 支持', link: '/guide/pwa' },
          { text: 'Electron 客户端', link: '/guide/electron' },
          { text: '项目维护', link: '/guide/contributing' },
          { text: 'Demo 演示模式', link: '/guide/demo-mode' },
        ],
      },
      {
        text: '产品与能力',
        collapsed: false,
        items: [
          { text: '产品概览', link: '/product/overview' },
          { text: '功能模块', link: '/product/features' },
        ],
      },
      {
        text: '开发规范',
        collapsed: false,
        items: [
          { text: 'API 规范', link: '/backend/api-conventions' },
          { text: '请求上下文与当前用户', link: '/backend/request-context' },
          { text: '数据库与迁移', link: '/backend/database' },
          { text: '数据库事务', link: '/backend/database-transactions' },
          { text: '数据库操作规范', link: '/backend/database-operations' },
          { text: 'Swagger / OpenAPI', link: '/backend/swagger' },
          { text: '前端 UI 规范', link: '/frontend/ui-conventions' },
          { text: '认证与请求', link: '/frontend/auth-request' },
          { text: '公共组件', link: '/frontend/components' },
          { text: '文件预览组件', link: '/frontend/file-preview' },
          { text: '路由与菜单', link: '/frontend/routing' },
        ],
      },
      {
        text: '业务模块',
        collapsed: false,
        items: [
          { text: '权限与组织', link: '/iam/' },
          { text: '即时通讯', link: '/chat/' },
          { text: '会员中心', link: '/member/' },
          { text: '通知中心', link: '/notification/' },
          { text: '文件与存储', link: '/storage/' },
          { text: 'AI 能力', link: '/ai-platform/' },
        ],
      },
      {
        text: '工作流',
        collapsed: true,
        items: [
          { text: '总览', link: '/workflow/' },
          { text: '流程设计器', link: '/workflow/designer' },
          { text: '表单设计', link: '/workflow/form-design' },
          { text: '业务模块接入', link: '/workflow/business-integration' },
          { text: '节点配置', link: '/workflow/node-config' },
          { text: '节点类型', link: '/workflow/node-types' },
          { text: '审批方式与驳回策略', link: '/workflow/approval' },
          { text: '流程实例生命周期', link: '/workflow/instance-lifecycle' },
          { text: '权限与范围控制', link: '/workflow/permissions' },
          { text: '事件总线', link: '/workflow/event-bus' },
          { text: '事件订阅', link: '/workflow/event-subscriptions' },
          { text: '触发器节点', link: '/workflow/trigger-nodes' },
          { text: '流程自动化', link: '/workflow/automations' },
          { text: '外部审批', link: '/workflow/external-approval' },
        ],
      },
      {
        text: '支付中心',
        collapsed: true,
        items: [
          { text: '总览', link: '/payment/' },
          { text: '渠道适配与配置', link: '/payment/channels' },
          { text: '业务接入', link: '/payment/integration' },
          { text: '异步通知与对账', link: '/payment/callback' },
          { text: '安全设计', link: '/payment/security' },
          { text: '后台管理页面', link: '/payment/admin' },
        ],
      },
      {
        text: '数据分析',
        collapsed: true,
        items: [
          { text: '总览', link: '/analytics/' },
          { text: '埋点采集 SDK', link: '/analytics/tracking' },
          { text: '行为分析', link: '/analytics/behavior' },
          { text: '数据管理', link: '/analytics/data-management' },
          { text: '错误监控', link: '/analytics/error-monitoring' },
          { text: '架构与数据模型', link: '/analytics/architecture' },
        ],
      },
      {
        text: '系统运维与可观测',
        collapsed: true,
        items: [
          { text: '系统运维', link: '/ops/' },
          { text: '定时任务', link: '/backend/cron-jobs' },
          { text: '维护模式', link: '/backend/maintenance-mode' },
          { text: '操作日志与变更记录', link: '/backend/audit-log-changes' },
        ],
      },
      {
        text: '安全与基础设施',
        collapsed: true,
        items: [
          { text: '安全体系', link: '/backend/security' },
          { text: '幂等防重复提交', link: '/backend/idempotency' },
          { text: '多租户指南', link: '/backend/multi-tenant' },
          { text: '系统内置配置', link: '/backend/system-configs' },
          { text: 'OAuth 第三方登录', link: '/backend/oauth' },
          { text: '外呼 HTTP 客户端', link: '/backend/http-client' },
          { text: 'HTTP 流量日志', link: '/backend/http-logging' },
          { text: 'WebSocket 事件清单', link: '/backend/websocket-events' },
          { text: 'WebRTC 音视频通话', link: '/backend/webrtc-calls' },
        ],
      },
      {
        text: 'AI 辅助开发',
        collapsed: true,
        items: [
          { text: '概览', link: '/ai/' },
          { text: 'AGENTS.md', link: '/ai/agents' },
          { text: 'Zenith Skill', link: '/ai/skills' },
        ],
      },
      {
        text: '参考资料',
        collapsed: true,
        items: [{ text: 'Changelog', link: '/changelog/' }],
      },
    ],
    outline: {
      level: [2, 3],
      label: '页面导航',
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
  },
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
  ],
});
