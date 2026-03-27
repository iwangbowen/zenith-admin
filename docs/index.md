---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 全栈后台项目底座
  tagline: 基于 Hono + React + Semi Design + Drizzle ORM 的全栈后台管理底座，内置常用后台能力与可选多租户支持，原生 AI 友好，一句话生成完整 CRUD 模块。
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
  - title: Semi Design UI
    details: 前端基于抖音开源的 Semi Design v2 组件库，提供完整的企业级 UI 组件，图标统一使用 lucide-react。
  - title: 用户 / 角色 / 菜单
    details: 支持动态菜单配置与 RBAC 权限控制，提供按钮级别鉴权能力。
  - title: 共享类型层
    details: Zod Schema 在前后端共享，统一校验逻辑，减少字段不一致风险。
  - title: 文件存储
    details: 支持本地存储与阿里云 OSS 两种模式，可在后台配置页面切换。
  - title: JWT 双 Token 鉴权
    details: 采用 Access Token + Refresh Token 双 token 机制，前端自动续期，对业务代码透明，中间件统一处理鉴权逻辑。
  - title: 多租户支持
    details: 内置租户管理模块，支持 tenant_id 级数据隔离、平台超管视角切换与登录时租户路由。默认关闭，开启不影响已有单实例部署。
  - title: 数据库迁移
    details: Schema 变更通过 Drizzle 迁移管理，SQL 历史文件可追溯版本变更。
---

<section class="zn-section">
  <h2 class="zn-title">技术选型</h2>
  <p class="zn-desc">项目使用的主要技术栈。</p>
  <ul class="zn-deflist">
    <li><span class="zn-term">后端</span><span class="zn-def">Hono v4 · Node.js · Drizzle ORM · PostgreSQL</span></li>
    <li><span class="zn-term">前端</span><span class="zn-def">React 19 · Vite · <a href="https://semi.design/" target="_blank">Semi Design v2</a> · react-router v7 · lucide-react</span></li>
    <li><span class="zn-term">工程</span><span class="zn-def">npm monorepo · 共享 Zod 校验 · JWT 鉴权</span></li>
  </ul>
</section>

<section class="zn-section">
  <h2 class="zn-title">目录结构</h2>
  <p class="zn-desc">项目采用 npm monorepo 结构，分为三个子包。</p>
  <ul class="zn-deflist">
    <li><span class="zn-term"><code>packages/server</code></span><span class="zn-def">Hono 路由 + Drizzle schema + 业务逻辑</span></li>
    <li><span class="zn-term"><code>packages/web</code></span><span class="zn-def">React 页面 + Semi 组件 + 状态管理</span></li>
    <li><span class="zn-term"><code>packages/shared</code></span><span class="zn-def">TypeScript 类型 + Zod 校验 + 常量</span></li>
  </ul>
</section>

<section class="zn-section">
  <h2 class="zn-title">从这里开始</h2>
  <ul class="zn-navlist">
    <li><a href="/guide/getting-started">快速开始</a> — 环境准备 → 启动项目 → 看到页面</li>
    <li><a href="/guide/project-structure">项目结构</a> — 目录分层与职责说明</li>
    <li><a href="/ai/">AI 辅助开发</a> — 使用 Zenith Skill 一句话生成 CRUD 模块</li>
    <li><a href="/product/features">功能清单</a> — 已实现模块一览</li>
    <li><a href="/backend/api-conventions">接口规范</a> — 响应格式 · 鉴权 · 分页</li>
    <li><a href="/backend/multi-tenant">多租户指南</a> — 租户配置 · 数据隔离 · 平台视角切换</li>
  </ul>
</section>
