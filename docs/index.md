---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 开箱即用的全栈后台底座
  tagline: 用户、权限、菜单、字典、文件管理——常见后台能力已就位，clone 下来就能往里写业务。
  actions:
    - theme: brand
      text: 快速开始 →
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/iwangbowen/zenith-admin
features:
  - title: 用户 · 角色 · 菜单
    details: RBAC 权限体系开箱可用，支持动态菜单和按钮级鉴权。
  - title: 前后端共享类型
    details: Zod schema + TypeScript 类型在 shared 包里统一维护，联调少踩坑。
  - title: 两种文件存储
    details: 本地磁盘与阿里云 OSS 可切换，后台配置即生效。
  - title: 数据字典
    details: 系统级键值对管理，下拉框、状态码、枚举等场景直接调用。
  - title: JWT 认证
    details: Bearer Token + 7 天有效期，中间件自动注入用户上下文。
  - title: 数据库迁移
    details: Drizzle ORM 管理 schema 变更，migration 文件可追溯、可回滚。
---

<section class="zn-section">
  <h2 class="zn-title">技术选型</h2>
  <p class="zn-desc">几个你可能在意的技术点，这里先交个底。</p>
  <div class="zn-tech-row">
    <dl class="zn-tech-item">
      <dt>后端</dt>
      <dd>Hono v4 · Node.js · Drizzle ORM · PostgreSQL</dd>
    </dl>
    <dl class="zn-tech-item">
      <dt>前端</dt>
      <dd>React 19 · Vite · Semi Design · react-router v7</dd>
    </dl>
    <dl class="zn-tech-item">
      <dt>工程</dt>
      <dd>npm monorepo · 共享 Zod 校验 · JWT 鉴权</dd>
    </dl>
  </div>
</section>

<section class="zn-section">
  <h2 class="zn-title">目录结构</h2>
  <p class="zn-desc">三个包，各管各的事。</p>
  <div class="zn-struct">
    <div class="zn-struct-item">
      <code>packages/server</code>
      <span>Hono 路由 + Drizzle schema + 业务逻辑</span>
    </div>
    <div class="zn-struct-item">
      <code>packages/web</code>
      <span>React 页面 + Semi 组件 + 状态管理</span>
    </div>
    <div class="zn-struct-item">
      <code>packages/shared</code>
      <span>TypeScript 类型 + Zod 校验 + 常量</span>
    </div>
  </div>
</section>

<section class="zn-section">
  <h2 class="zn-title">从这里开始</h2>
  <div class="zn-links">
    <a class="zn-link" href="./guide/getting-started">快速开始<small>环境准备 → 启动项目 → 看到页面</small></a>
    <a class="zn-link" href="./guide/project-structure">项目结构<small>目录分层与职责说明</small></a>
    <a class="zn-link" href="./product/features">功能清单<small>已实现模块一览</small></a>
    <a class="zn-link" href="./backend/api-conventions">接口规范<small>响应格式 · 鉴权 · 分页</small></a>
  </div>
</section>
