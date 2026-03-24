---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 全栈后台项目底座
  tagline: 基于 Hono + React + Drizzle ORM 的全栈后台管理底座，内置常用后台能力，开箱即用。
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
  - title: 用户 / 角色 / 菜单
    details: 支持动态菜单配置与 RBAC 权限控制，提供按钮级别鉴权能力。
  - title: 共享类型层
    details: Zod Schema 在前后端共享，统一校验逻辑，减少字段不一致风险。
  - title: 文件存储
    details: 支持本地存储与阿里云 OSS 两种模式，可在后台配置页面切换。
  - title: 数据字典
    details: 通过后台配置动态管理枚举类型，无需修改代码即可变更选项。
  - title: JWT 鉴权
    details: 采用 JWT Bearer Token 认证，有效期 7 天，中间件统一处理鉴权逻辑。
  - title: 数据库迁移
    details: Schema 变更通过 Drizzle 迁移管理，SQL 历史文件可追溯版本变更。
---

<section class="zn-section">
  <h2 class="zn-title">技术选型</h2>
  <p class="zn-desc">项目使用的主要技术栈。</p>
  <ul class="zn-deflist">
    <li><span class="zn-term">后端</span><span class="zn-def">Hono v4 · Node.js · Drizzle ORM · PostgreSQL</span></li>
    <li><span class="zn-term">前端</span><span class="zn-def">React 19 · Vite · Semi Design · react-router v7</span></li>
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
    <li><a href="/product/features">功能清单</a> — 已实现模块一览</li>
    <li><a href="/backend/api-conventions">接口规范</a> — 响应格式 · 鉴权 · 分页</li>
  </ul>
</section>
