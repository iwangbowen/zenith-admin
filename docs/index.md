---
layout: home
title: Zenith Admin
titleTemplate: false
hero:
  name: Zenith Admin
  text: 更快构建企业级后台系统
  tagline: 一个现成可用、也适合继续二开的后台系统底座。用户、权限、菜单、字典、文件管理这些常见能力，项目里已经先帮你铺好了。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看功能模块
      link: /product/features
    - theme: alt
      text: GitHub
      link: https://github.com/iwangbowen/zenith-admin
features:
  - title: 基础模块先配齐
    details: 用户、角色、菜单、字典、文件这些后台常见模块已经在仓库里，不用每次都从零搭一遍。
  - title: 结构不绕人
    details: server、web、shared 三层职责明确，接口、类型和校验规则都能顺着目录快速找到。
  - title: 适合继续加业务
    details: 它不是演示页面集合，而是一套能继续往里加模块、加页面、加表单的项目骨架。
  - title: 技术栈比较新
    details: Hono + React 19 + Drizzle ORM + PostgreSQL，轻量但不简陋，开发体验也在线。
  - title: 前后端少扯皮
    details: 基于共享类型和 Zod schema，能少掉很多“接口字段到底是谁改了”的日常消耗。
  - title: 文档也一起维护
    details: 项目介绍、开发说明和后续 changelog 可以直接沉淀在同一个文档站里。
---

<div class="home-panel">
  <p class="landing-badge">产品定位</p>
  <h2 class="landing-heading">不是拿来截图的官网，而是能直接开干的后台项目底座。</h2>
  <p class="landing-subtitle">
    如果你正准备做一个管理后台、运营平台或内部工具，Zenith Admin 更像是一个已经铺好地基的起点。
    常见模块先给到、技术栈不老、结构也清楚，适合先跑起来，再慢慢把业务往里装。
  </p>

  <div class="home-grid">
    <div class="home-card">
      <h3>快上手</h3>
      <p>依赖装好、环境变量配上、数据库迁移跑完，前后端就能直接启动，不需要先写一周脚手架。</p>
    </div>
    <div class="home-card">
      <h3>好扩展</h3>
      <p>共享层把类型和校验兜住，后端路由和前端页面也分得清，后面继续加业务会轻松很多。</p>
    </div>
    <div class="home-card">
      <h3>够稳妥</h3>
      <p>接口格式、JWT 鉴权、分页规范、数据库迁移流程这些基础规则，项目里已经先定好了。</p>
    </div>
  </div>
</div>

<div class="home-panel">
  <p class="landing-badge">项目概览</p>
  <h2 class="landing-heading">先把后台最常用的部分搭好，再把时间花在真正的业务上。</h2>
  <div class="home-stats">
    <div class="home-stat">
      <strong>3</strong>
      <p>个核心包：<code>server</code>、<code>web</code>、<code>shared</code>，看目录就知道东西该去哪里找。</p>
    </div>
    <div class="home-stat">
      <strong><code>/api</code></strong>
      <p>统一接口前缀与响应格式，联调和排查问题会省心不少。</p>
    </div>
    <div class="home-stat">
      <strong>2</strong>
      <p>种文件存储模式：本地文件系统和阿里云 OSS，按项目场景切换就行。</p>
    </div>
  </div>

  <ol class="home-timeline">
    <li><strong>后端：</strong>Hono 负责 <code>/api</code> 路由，Drizzle ORM 负责 PostgreSQL schema、迁移和数据落地。</li>
    <li><strong>前端：</strong>React 19 + Vite + Semi Design，适合后台页面、表格、表单这一类高频场景。</li>
    <li><strong>共享层：</strong>类型、常量和 Zod 校验可以复用，少掉很多“前后端各写一份”的重复劳动。</li>
  </ol>
</div>

<div class="home-panel">
  <p class="landing-badge">适用场景</p>
  <h2 class="landing-heading">这些场景里，它会比较顺手</h2>
  <div class="home-scenarios">
    <div class="scenario-card">
      <h3>中后台管理系统</h3>
      <p>如果你要做业务后台或运营平台，这套基础能力基本能直接接住第一阶段需求。</p>
    </div>
    <div class="scenario-card">
      <h3>内部工具平台</h3>
      <p>团队要快速上线一个管理端时，用它会比从零起盘更踏实，也更容易统一代码习惯。</p>
    </div>
    <div class="scenario-card">
      <h3>二次开发模板</h3>
      <p>如果你在意代码规范、目录边界和后期维护，它也适合当作长期演进的项目模板。</p>
    </div>
    <div class="scenario-card">
      <h3>演示与 PoC</h3>
      <p>做方案演示、客户 PoC 或内部验证时，它的完成度已经够用，不会显得太“半成品”。</p>
    </div>
  </div>
</div>

<div class="home-panel">
  <p class="landing-badge">快速入口</p>
  <h2 class="landing-heading">第一次看这个项目，建议先从这里走</h2>
  <div class="quick-entry-grid">
    <a class="quick-entry" href="/guide/getting-started">
      <h3>快速开始</h3>
      <p>先把依赖、环境变量和启动流程跑通，十分钟内能看到完整界面。</p>
    </a>
    <a class="quick-entry" href="/guide/project-structure">
      <h3>项目结构</h3>
      <p>快速摸清 monorepo 的目录分层，知道每类代码应该放在哪里。</p>
    </a>
    <a class="quick-entry" href="/product/features">
      <h3>功能模块</h3>
      <p>看看现成模块够不够用，再决定是直接上还是继续扩展。</p>
    </a>
    <a class="quick-entry" href="/backend/api-conventions">
      <h3>接口规范</h3>
      <p>了解响应格式、鉴权、分页和参数校验这些协作基础约定。</p>
    </a>
  </div>
  <div class="home-note">
    这一步先把本地可用版本和内容结构做好；等你确认风格和目录没问题，再补 GitHub Pages 自动化部署。
  </div>
</div>
