<script setup lang="ts">
import { withBase } from 'vitepress'
import BentoCell from './BentoCell.vue'
import './arts/art-base.css'
import ArtWorkflow from './arts/ArtWorkflow.vue'
import ArtIam from './arts/ArtIam.vue'
import ArtAi from './arts/ArtAi.vue'
import ArtReport from './arts/ArtReport.vue'
import ArtChat from './arts/ArtChat.vue'
import ArtPayment from './arts/ArtPayment.vue'
import ArtOps from './arts/ArtOps.vue'
import ArtOpenPlatform from './arts/ArtOpenPlatform.vue'
import ArtMember from './arts/ArtMember.vue'
import ArtCms from './arts/ArtCms.vue'
import ArtWiki from './arts/ArtWiki.vue'
import ArtRules from './arts/ArtRules.vue'
import ArtNotification from './arts/ArtNotification.vue'
import ArtMp from './arts/ArtMp.vue'
import ArtAnalytics from './arts/ArtAnalytics.vue'
import ArtStorage from './arts/ArtStorage.vue'
import ArtSecurity from './arts/ArtSecurity.vue'
import ArtTasks from './arts/ArtTasks.vue'
import ArtTenant from './arts/ArtTenant.vue'
import ArtPersonal from './arts/ArtPersonal.vue'
import ArtDrive from './arts/ArtDrive.vue'
</script>

<template>
  <section class="bento-wrap">
    <div class="bento__bar">
      <p>16 个业务域 · 130+ 功能点，共享一套部署单元与数据库，按需启用。</p>
      <a :href="withBase('/product/features')">查看完整功能清单 →</a>
    </div>

    <div class="bento">
      <BentoCell title="工作流引擎" tag="workflow" link="/workflow/" :cols="4" :rows="2"
        desc="可视化设计器、条件分支、会签 / 或签、审批代理与定时发起；触发器、连接器与移动审批轻页开箱即用。">
        <ArtWorkflow />
      </BentoCell>
      <BentoCell title="权限与组织" tag="iam" link="/iam/" :cols="4"
        desc="RBAC、动态菜单、按钮级鉴权与数据范围；部门、岗位、用户组全覆盖。">
        <ArtIam />
      </BentoCell>
      <BentoCell title="AI 智能助手" tag="ai" link="/ai-platform/" :cols="4"
        desc="Mastra 驱动的流式对话、智能体、RAG 知识库、工具调用与模型评测。">
        <ArtAi />
      </BentoCell>
      <BentoCell title="报表中心" tag="report" link="/report/" :cols="4"
        desc="多源接入、仪表盘、数据大屏、类 Excel 打印报表与 ChatBI 智能问数。">
        <ArtReport />
      </BentoCell>
      <BentoCell title="即时通讯" tag="chat" link="/chat/" :cols="4"
        desc="单聊 / 群聊、WebRTC 音视频通话、客服工作台与聊天机器人。">
        <ArtChat />
      </BentoCell>

      <BentoCell title="支付中心" tag="payment" link="/payment/" :cols="4"
        desc="微信 / 支付宝多渠道、订单生命周期、对账、分账与风控。">
        <ArtPayment />
      </BentoCell>
      <BentoCell title="运维终端" tag="ops" link="/ops/" :cols="4" dark
        desc="Web SSH、终端录屏、Docker、进程与网络诊断、应用在线升级。">
        <ArtOps />
      </BentoCell>
      <BentoCell title="开放平台" tag="open-platform" link="/open-platform/" :cols="4"
        desc="OAuth 2.1、HMAC 签名网关、Scope 限流、Webhook 与在线调试台。">
        <ArtOpenPlatform />
      </BentoCell>

      <BentoCell title="会员中心" tag="member" link="/member/"
        desc="等级、积分、钱包、优惠券与签到；独立 C 端门户双轨隔离。">
        <ArtMember />
      </BentoCell>
      <BentoCell title="CMS 内容管理" tag="cms" link="/cms/"
        desc="多站点栏目、内容模型、可视化搭建、静态化发布与全文检索。">
        <ArtCms />
      </BentoCell>
      <BentoCell title="知识中心" tag="wiki" link="/wiki/"
        desc="空间权限、文档树与版本历史、评论协作与发布审批。">
        <ArtWiki />
      </BentoCell>
      <BentoCell title="企业网盘" tag="drive" link="/drive/"
        desc="个人 / 部门 / 协作空间，文件权限、版本、外链分享与回收站统一管理。">
        <ArtDrive />
      </BentoCell>
      <BentoCell title="规则中心" tag="rules" link="/rules/"
        desc="决策表、决策流、评分卡与名单库；decide() 统一求值与执行留痕。">
        <ArtRules />
      </BentoCell>

      <BentoCell title="通知中心" tag="notification" link="/notification/"
        desc="事件驱动的多渠道触达，偏好、免打扰与投递留痕统一收口。">
        <ArtNotification />
      </BentoCell>
      <BentoCell title="微信公众号" tag="mp" link="/mp/"
        desc="多账号、粉丝标签、自动回复、自定义菜单、群发与模板消息。">
        <ArtMp />
      </BentoCell>
      <BentoCell title="数据分析" tag="analytics" link="/analytics/"
        desc="行为埋点、多维大盘、前端错误监控与会话回放。">
        <ArtAnalytics />
      </BentoCell>
      <BentoCell title="文件与存储" tag="storage" link="/storage/"
        desc="9 种存储后端可切换，Magic Bytes 校验与在线文件预览。">
        <ArtStorage />
      </BentoCell>

      <BentoCell title="安全防护" tag="security" link="/backend/security"
        desc="身份安全策略、登录风险事件与企业身份源，安全默认开启。">
        <ArtSecurity />
      </BentoCell>
      <BentoCell title="任务中心" tag="tasks" link="/backend/task-center"
        desc="pg-boss 调度、进度、重试与导出中心，异步任务统一入口。">
        <ArtTasks />
      </BentoCell>
      <BentoCell title="多租户" tag="tenant" link="/backend/multi-tenant"
        desc="可选租户隔离、套餐与视角切换，内置 License 授权支持。">
        <ArtTenant />
      </BentoCell>
      <BentoCell title="个性化 · 客户端" tag="client" link="/guide/pwa"
        desc="19 种主题色、灰色 / 色弱模式，PWA 与 Electron 桌面客户端。">
        <ArtPersonal />
      </BentoCell>
    </div>
  </section>
</template>

<style scoped>
.bento-wrap {
  max-width: 1160px;
  margin: 0 auto;
  padding: 0 24px;
}

.bento__bar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  font-size: 13.5px;
}

.bento__bar p {
  margin: 0;
  color: var(--zn-text-2);
}

.bento__bar a {
  flex: none;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}

.bento__bar a:hover {
  text-decoration: underline;
}

.bento {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: minmax(200px, auto);
  gap: 14px;
}

@media (max-width: 640px) {
  .bento-wrap {
    padding: 0 16px;
  }

  .bento__bar {
    flex-direction: column;
    gap: 4px;
  }

  .bento {
    grid-auto-rows: auto;
  }
}
</style>
