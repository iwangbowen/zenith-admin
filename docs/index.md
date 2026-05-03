---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 简洁、强大、可持续演进的全栈后台底座
  tagline: 基于 Hono + React + Semi Design + Drizzle ORM，内置权限、审计、存储、多租户等后台高频能力，默认开箱可用，同时为 AI 协作开发预留清晰边界。
  actions:
    - theme: brand
      text: 快速开始 →
      link: /guide/getting-started
    - theme: alt
      text: 在线演示 →
      link: https://iwangbowen.github.io/zenith-admin/demo/
    - theme: alt
      text: GitHub
      link: https://github.com/iwangbowen/zenith-admin
features:
  - title: 角色权限与菜单治理
    details: 支持 RBAC、动态菜单、按钮级鉴权，权限边界清晰，适合中后台长期演进。
  - title: API + 类型 + 校验一体化
    details: 共享 TypeScript 类型与 Zod Schema，前后端约束统一，减少联调与回归成本。
  - title: 文件存储可插拔
    details: 支持 local / OSS / S3 / COS 四种模式，后台一键切换默认存储，满足不同部署环境。
  - title: 多租户与系统配置
    details: 内置租户隔离与平台视角，支持逐租户配置扩展，默认关闭不影响单租户部署。
  - title: 安全与可观测能力
    details: JWT 双 Token、会话黑名单、请求防护、操作日志与登录日志，覆盖后台核心安全链路。
  - title: AI 友好工程结构
    details: 明确分层与规范化目录，支持通过 AI 指令快速生成 CRUD，并保持代码可读可维护。
---

<section class="zn-section">
  <h2 class="zn-title">技术选型</h2>
  <p class="zn-desc">成熟技术栈组合，兼顾开发效率与运行稳定性。</p>
  <ul class="zn-deflist">
    <li><span class="zn-term">后端</span><span class="zn-def">Hono v4 · Node.js · Drizzle ORM · PostgreSQL</span></li>
    <li><span class="zn-term">前端</span><span class="zn-def">React 19 · Vite · <a href="https://semi.design/" target="_blank">Semi Design v2</a> · react-router v7 · lucide-react</span></li>
    <li><span class="zn-term">工程</span><span class="zn-def">npm monorepo · 共享 Zod 校验 · JWT 鉴权</span></li>
  </ul>
  <h3 class="zn-subtitle">架构分层</h3>
  <p class="zn-desc">清晰职责分工，让业务迭代与团队协作都更顺畅。</p>
  <div class="zn-arch-grid">
    <article class="zn-arch-card">
      <h3><code>packages/server</code></h3>
      <p>Hono 路由、Drizzle 数据访问、业务服务层与 OpenAPI 文档输出。</p>
    </article>
    <article class="zn-arch-card">
      <h3><code>packages/web</code></h3>
      <p>React 页面、Semi Design 交互组件与统一请求封装，支持 Demo Mock 模式。</p>
    </article>
    <article class="zn-arch-card">
      <h3><code>packages/shared</code></h3>
      <p>共享类型、常量与校验 schema，降低前后端字段漂移风险。</p>
    </article>
  </div>
</section>

<section class="zn-section">
<h2 class="zn-title">核心能力矩阵</h2>
<FeatureMatrixFlow />
</section>

<section class="zn-section">
  <h2 class="zn-title">推荐阅读路径</h2>
  <ul class="zn-navlist">
    <li><a href="/guide/getting-started">快速开始</a> — 环境准备、安装依赖、启动服务</li>
    <li><a href="/guide/project-structure">项目结构</a> — 目录职责与关键模块定位</li>
    <li><a href="/product/features">功能清单</a> — 已实现能力全景扫描</li>
    <li><a href="/backend/api-conventions">接口规范</a> — 响应结构、错误处理与分页约定</li>
    <li><a href="/backend/multi-tenant">多租户指南</a> — 如何开启租户、隔离数据与管理平台视角</li>
    <li><a href="/ai/">AI 辅助开发</a> — 使用 Zenith Skill 加速模块开发</li>
  </ul>
</section>
