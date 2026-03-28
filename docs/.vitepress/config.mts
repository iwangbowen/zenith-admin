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
  themeConfig: {
    siteTitle: 'Zenith Admin',
    logo: '/favicon.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: 'AI 辅助开发', link: '/ai/' },
      { text: '产品', link: '/product/overview' },
      { text: '后端', link: '/backend/api-conventions' },
      { text: '前端', link: '/frontend/ui-conventions' },
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
          { text: '项目维护', link: '/guide/contributing' },
          { text: 'Demo 演示模式', link: '/guide/demo-mode' },
        ],
      },
      {
        text: 'AI 辅助开发',
        collapsed: false,
        items: [
          { text: '概览', link: '/ai/' },
          { text: 'AGENTS.md', link: '/ai/agents' },
          { text: 'Zenith Skill', link: '/ai/skills' },
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
        text: '后端',
        collapsed: true,
        items: [
          { text: 'API 规范', link: '/backend/api-conventions' },
          { text: '数据库与迁移', link: '/backend/database' },
          { text: 'Swagger / OpenAPI', link: '/backend/swagger' },
          { text: '多租户指南', link: '/backend/multi-tenant' },
          { text: '系统内置配置', link: '/backend/system-configs' },
          { text: '操作日志与变更记录', link: '/backend/audit-log-changes' },
          { text: '安全体系', link: '/backend/security' },
          { text: 'OAuth 第三方登录', link: '/backend/oauth' },
          { text: '定时任务与数据库备份', link: '/backend/jobs-and-backup' },
        ],
      },
      {
        text: '前端',
        collapsed: true,
        items: [
          { text: 'UI 规范', link: '/frontend/ui-conventions' },
          { text: '认证与请求', link: '/frontend/auth-request' },
          { text: '公共组件', link: '/frontend/components' },
          { text: '路由与菜单', link: '/frontend/routing' },
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
