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
          { text: '导出中心', link: '/backend/export-center' },
          { text: '任务中心', link: '/backend/task-center' },
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
          { text: '报表中心', link: '/report/' },
          { text: '微信公众号', link: '/mp/' },
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
          { text: '导出中心', link: '/backend/export-center' },
          { text: '任务中心', link: '/backend/task-center' },
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
        text: '微信公众号',
        collapsed: true,
        items: [
          { text: '总览', link: '/mp/' },
          { text: '公众号账号', link: '/mp/accounts' },
          { text: '粉丝、标签与会员', link: '/mp/fans' },
          { text: '消息与自动回复', link: '/mp/messages' },
          { text: '多客服会话治理', link: '/mp/customer-service' },
          { text: '菜单管理', link: '/mp/menus' },
          { text: '素材与图文草稿', link: '/mp/materials' },
          { text: '群发、模板与二维码', link: '/mp/marketing' },
          { text: '网页授权与 JS-SDK', link: '/mp/web-dev' },
          { text: '数据统计与内容安全', link: '/mp/statistics' },
        ],
      },
      {
        text: '工作流',
        collapsed: true,
        items: [
          { text: '总览', link: '/workflow/' },
          { text: '流程定义与设计器', link: '/workflow/designer' },
          { text: '流程模板', link: '/workflow/templates' },
          { text: '表单、数据源与连接器', link: '/workflow/form-design' },
          { text: '节点配置', link: '/workflow/node-config' },
          { text: '节点类型', link: '/workflow/node-types' },
          { text: '审批、任务与协作', link: '/workflow/approval' },
          { text: '实例生命周期', link: '/workflow/instance-lifecycle' },
          { text: '触发器与外部审批', link: '/workflow/trigger-nodes' },
          { text: '事件总线与事件订阅', link: '/workflow/event-bus' },
          { text: '流程自动化与定时发起', link: '/workflow/automations' },
          { text: '监控、诊断与运维', link: '/workflow/monitoring-operations' },
          { text: '业务模块接入', link: '/workflow/business-integration' },
          { text: '权限与范围控制', link: '/workflow/permissions' },
        ],
      },
      {
        text: '支付中心',
        collapsed: true,
        items: [
          { text: '总览', link: '/payment/' },
          { text: '渠道适配与配置', link: '/payment/channels' },
          { text: '业务接入', link: '/payment/integration' },
          { text: '业务接入实战示例', link: '/payment/integration-example' },
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
        text: '报表中心',
        collapsed: true,
        items: [
          { text: '总览', link: '/report/' },
          { text: '数据源接入', link: '/report/datasources' },
          { text: '数据集与数据加工', link: '/report/datasets' },
          { text: '仪表盘设计', link: '/report/dashboards' },
          { text: '数据大屏', link: '/report/data-screen' },
          { text: '类 Excel 打印报表', link: '/report/print-reports' },
          { text: 'AI 问数与数据预警', link: '/report/ai-and-alerts' },
          { text: '分享 / 订阅 / 嵌入 / 协作', link: '/report/sharing' },
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
