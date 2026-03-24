---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 全栈后台项目底座
  tagline: 常见后台能力已就位，clone 下来直接往里加业务。
  actions:
    - theme: brand
      text: 快速开始 →
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/iwangbowen/zenith-admin
features:
  - title: 用户 / 角色 / 菜单
    details: 动态菜单 + RBAC 权限，按钮级鉴权，直接能用。
  - title: 共享类型层
    details: Zod schema 在 server 和 web 里共用一份，字段不一致的问题少很多。
  - title: 文件存储
    details: 本地和阿里云 OSS 两种模式，在后台切换一下就行。
  - title: 数据字典
    details: 改下拉框选项不用动代码，后台配置就能改。
  - title: JWT 鉴权
    details: 7 天 Token，中间件接管认证逻辑，路由层不用重复写。
  - title: 数据库迁移
    details: schema 改了就跑 migrate，有 SQL 文件可以追溯历史变更。
---

<section class="zn-section">
  <h2 class="zn-title">技术选型</h2>
  <p class="zn-desc">几个你可能在意的技术点，先交个底。</p>
  <ul class="zn-deflist">
    <li><span class="zn-term">后端</span><span class="zn-def">Hono v4 · Node.js · Drizzle ORM · PostgreSQL</span></li>
    <li><span class="zn-term">前端</span><span class="zn-def">React 19 · Vite · Semi Design · react-router v7</span></li>
    <li><span class="zn-term">工程</span><span class="zn-def">npm monorepo · 共享 Zod 校验 · JWT 鉴权</span></li>
  </ul>
</section>

<section class="zn-section">
  <h2 class="zn-title">目录结构</h2>
  <p class="zn-desc">三个包，各管各的事。</p>
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
