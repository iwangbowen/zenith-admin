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
  - title: 权限与组织管理
    details: RBAC 角色模型、动态菜单、按钮级鉴权；部门树、岗位、用户组全覆盖，批量导入/启停/重置密码，用户在线状态实时显示。
  - title: 工作流引擎
    details: 可视化流程设计器（审批/抄送/条件分支/延迟器）、表单库、模板库、发起工作台、审批代理、流程自动化与事件订阅，支持外部审批与 Webhook 通知。
  - title: AI 智能助手
    details: SSE 流式多会话对话、PDF 上传预览、提示词模板、模型与服务商配置、个人 AI Key、用量统计与反馈处理，支持按系统或个人配置选择模型。
  - title: 即时通讯与多渠道通知
    details: 内置 WebSocket 单聊/群聊、站内信、公告推送；邮件/短信多服务商可插拔，消息模板统一维护。
  - title: 安全防护全链路
    details: JWT 双 Token、IP 访问控制、登录锁定、数据脱敏、幂等防重提交、接口限流、文件类型 Magic Bytes 校验，覆盖后台核心安全场景。
  - title: 运维与可观测
    details: 仪表盘、服务监控（SSE 实时）、定时任务（pg-boss）、数据库管理与备份、缓存管理、日志文件；Web SSH 终端、终端录屏、文件管理器、进程管理、Docker、网络诊断、systemd 服务管理。
  - title: 个性化、PWA 与桌面端
    details: 偏好设置（拼音搜索）、菜单收藏与最近访问、19 种主题色、路由动画、灰色/色弱模式；可选 PWA 支持与 Electron 桌面客户端。
  - title: 支付中心
    details: 多渠道支付配置（微信支付/支付宝等）、订单生命周期（下单/支付/关闭/退款）、支付回调日志全链路追踪，内置 outbox 事件防丢失。
  - title: 会员中心
    details: 前台 C 端独立 SPA（手机号验证码、手机号/邮箱/用户名密码登录）+ 后台管理双轨隔离；会员等级、积分账户、钱包余额（乐观锁防并发超扣）、优惠券模板、发券记录与签到。
  - title: 数据分析与错误监控
    details: 行为埋点（PV/UV/停留/点击）多维大盘展示；前端 JS 异常自动上报，错误堆栈一键查看，无需额外 APM 工具。
  - title: 报表中心
    details: 自助式报表平台（对标积木报表）。多源接入（API/MySQL/PG/SQL Server/Excel·CSV）、数据集加工（参数/计算字段/缓存/物化/数据权限）、23 种组件仪表盘、自由画布数据大屏、类 Excel 打印报表（套打/导出）、AI 问数(NL2SQL)、数据预警、分享订阅与跨模块嵌入。
---

<script setup>
import { withBase } from 'vitepress'
</script>

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
    <li><a :href="withBase('/guide/getting-started')">快速开始</a> — 环境准备、安装依赖、启动服务</li>
    <li><a :href="withBase('/guide/project-structure')">项目结构</a> — 目录职责与关键模块定位</li>
    <li><a :href="withBase('/product/features')">功能清单</a> — 已实现能力全景扫描</li>
    <li><a :href="withBase('/backend/api-conventions')">接口规范</a> — 响应结构、错误处理与分页约定</li>
    <li><a :href="withBase('/iam/')">权限与组织</a> — RBAC 角色、动态菜单、数据权限范围</li>
    <li><a :href="withBase('/member/')">会员中心</a> — 前台 C 端 + 后台管理双体系</li>
    <li><a :href="withBase('/ops/')">系统运维</a> — Web 终端、进程、Docker、网络诊断</li>
    <li><a :href="withBase('/ai/')">AI 辅助开发</a> — 使用 Zenith Skill 加速模块开发</li>
  </ul>
</section>
