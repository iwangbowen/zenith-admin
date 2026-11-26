<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'

interface Shot {
  src: string
  alt: string
  title: string
  desc: string
}

const shots: Shot[] = [
  { src: '/screenshots/users.webp', alt: '用户管理', title: '用户管理', desc: '组织树、部门岗位、角色与账号状态' },
  { src: '/screenshots/roles.webp', alt: '角色管理', title: '角色管理', desc: '角色权限、数据范围与用户分配' },
  { src: '/screenshots/menus.webp', alt: '菜单管理', title: '菜单管理', desc: '目录 / 页面 / 按钮三级权限模型' },
  { src: '/screenshots/departments.webp', alt: '部门管理', title: '部门管理', desc: '多级组织架构与部门负责人' },
  { src: '/screenshots/workflow-designer.webp', alt: '工作流设计器', title: '工作流设计器', desc: '条件分支、优先级与多级会签' },
  { src: '/screenshots/workflow-approval.webp', alt: '审批流转', title: '审批流转', desc: '表单快照、审批记录与流程时间线' },
  { src: '/screenshots/home.webp', alt: '工作台', title: '工作台', desc: '登录趋势、操作分布与公告' },
  { src: '/screenshots/member-dashboard.webp', alt: '会员看板', title: '会员看板', desc: '等级、积分、钱包与签到分析' },
  { src: '/screenshots/analytics.webp', alt: '行为分析', title: '行为分析', desc: 'PV / UV / 会话 / 事件趋势' },
  { src: '/screenshots/ai-chat.webp', alt: '智能对话', title: '智能对话', desc: '多模型流式回答与思维链' },
  { src: '/screenshots/wiki.webp', alt: '知识中心', title: '知识中心', desc: '空间、文档树与富文本阅读' },
  { src: '/screenshots/cms-contents.webp', alt: 'CMS 内容管理', title: 'CMS 内容管理', desc: '多站点、内容模型、审核发布与静态化' },
  { src: '/screenshots/dark-mode.webp', alt: '深色模式', title: '深色模式', desc: '同一套页面与图表的暗色主题' },
]

const demoUrl = 'https://iwangbowen.github.io/zenith-admin/demo/'

const activeIndex = ref<number | null>(null)
const active = computed(() => (activeIndex.value === null ? null : shots[activeIndex.value]))
const isOpen = computed(() => activeIndex.value !== null)

function open(index: number) {
  activeIndex.value = index
}

function close() {
  activeIndex.value = null
}

function prev() {
  if (activeIndex.value === null) return
  activeIndex.value = (activeIndex.value - 1 + shots.length) % shots.length
}

function next() {
  if (activeIndex.value === null) return
  activeIndex.value = (activeIndex.value + 1) % shots.length
}

function onKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prev()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
  }
}

let previousOverflow = ''

watch(isOpen, (value) => {
  if (typeof document === 'undefined') return
  if (value) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = previousOverflow
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = previousOverflow
})
</script>

<template>
  <section class="showcase">
    <div class="showcase__inner">
      <div class="showcase__head">
        <span class="zn-eyebrow">界面预览</span>
        <h2 class="zn-h2">真实后台，开箱即用</h2>
        <p class="zn-sub">
          从系统管理、流程审批到数据看板与 AI 对话，覆盖日常运营的完整链路。点击任意截图可放大查看。
        </p>
      </div>

      <div class="showcase__grid">
        <button
          v-for="(shot, index) in shots"
          :key="shot.src"
          type="button"
          class="showcase__item"
          :aria-label="`查看大图：${shot.title}`"
          @click="open(index)"
        >
          <img :src="withBase(shot.src)" :alt="shot.alt" loading="lazy" decoding="async" />
          <span class="showcase__caption">
            <b>{{ shot.title }}</b>
            <span>{{ shot.desc }}</span>
          </span>
        </button>
      </div>

      <p class="showcase__more">
        <a class="zn-btn zn-btn--primary" :href="demoUrl" target="_blank" rel="noreferrer">打开在线演示 →</a>
      </p>
    </div>
  </section>

  <Teleport to="body">
    <Transition name="zn-lightbox">
      <div
        v-if="isOpen && active"
        class="zn-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="active.title"
        @click.self="close"
      >
        <div class="zn-lightbox__top">
          <span class="zn-lightbox__count">{{ (activeIndex ?? 0) + 1 }} / {{ shots.length }}</span>
          <button type="button" class="zn-lightbox__icon-btn" aria-label="关闭预览" @click="close">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <button type="button" class="zn-lightbox__nav zn-lightbox__nav--prev" aria-label="上一张" @click="prev">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <figure class="zn-lightbox__figure" @click.stop>
          <img :src="withBase(active.src)" :alt="active.alt" />
          <figcaption>
            <b>{{ active.title }}</b>
            <span>{{ active.desc }}</span>
          </figcaption>
        </figure>

        <button type="button" class="zn-lightbox__nav zn-lightbox__nav--next" aria-label="下一张" @click="next">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <p class="zn-lightbox__hint">← → 切换 · Esc 关闭</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.showcase {
  padding: 56px 24px 32px;
}

.showcase__inner {
  max-width: 1160px;
  margin: 0 auto;
}

.showcase__head {
  max-width: 680px;
  margin-bottom: 28px;
}

.showcase__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.showcase__item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--zn-line);
  border-radius: 12px;
  background: var(--zn-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: zoom-in;
  transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
}

.showcase__item:hover {
  border-color: var(--zn-line-strong);
  transform: translateY(-2px);
  box-shadow: var(--zn-shadow);
}

.showcase__item img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}

.showcase__caption {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 13px 12px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--zn-text-2);
}

.showcase__caption b {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--zn-text-1);
}

.showcase__more {
  margin: 24px 0 0;
  text-align: center;
}

.zn-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 56px 24px 52px;
  background: rgba(8, 11, 18, 0.82);
  backdrop-filter: blur(8px);
}

.zn-lightbox__top {
  position: absolute;
  top: 18px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 16px;
  transform: translateX(-50%);
  color: #f8fafc;
}

.zn-lightbox__count {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: rgba(248, 250, 252, 0.8);
}

.zn-lightbox__icon-btn,
.zn-lightbox__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #f8fafc;
  cursor: pointer;
  transition: background 0.18s, transform 0.18s;
}

.zn-lightbox__icon-btn {
  width: 34px;
  height: 34px;
}

.zn-lightbox__nav {
  position: absolute;
  top: 50%;
  width: 46px;
  height: 46px;
  transform: translateY(-50%);
}

.zn-lightbox__nav--prev {
  left: 20px;
}

.zn-lightbox__nav--next {
  right: 20px;
}

.zn-lightbox__icon-btn:hover,
.zn-lightbox__nav:hover {
  background: rgba(255, 255, 255, 0.22);
}

.zn-lightbox__nav:active {
  transform: translateY(-50%) scale(0.94);
}

.zn-lightbox__figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: min(1180px, 92vw);
  margin: 0;
}

.zn-lightbox__figure img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 190px);
  border-radius: 10px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  background: #fff;
}

.zn-lightbox__figure figcaption {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  font-size: 13.5px;
  line-height: 1.4;
  color: rgba(248, 250, 252, 0.72);
  text-align: center;
}

.zn-lightbox__figure figcaption b {
  font-size: 14.5px;
  font-weight: 600;
  color: #f8fafc;
}

.zn-lightbox__hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  margin: 0;
  transform: translateX(-50%);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(248, 250, 252, 0.55);
  white-space: nowrap;
}

.zn-lightbox-enter-active,
.zn-lightbox-leave-active {
  transition: opacity 0.18s ease;
}

.zn-lightbox-enter-active .zn-lightbox__figure,
.zn-lightbox-leave-active .zn-lightbox__figure {
  transition: transform 0.18s ease;
}

.zn-lightbox-enter-from,
.zn-lightbox-leave-to {
  opacity: 0;
}

.zn-lightbox-enter-from .zn-lightbox__figure,
.zn-lightbox-leave-to .zn-lightbox__figure {
  transform: scale(0.97);
}

@media (min-width: 961px) {
  /* 13 张截图在 3 列布局下让最后一张居中，避免落单 */
  .showcase__item:last-child {
    grid-column: 2;
  }
}

@media (max-width: 960px) {
  .showcase__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .showcase {
    padding: 40px 16px 24px;
  }

  .showcase__grid {
    grid-template-columns: 1fr;
  }

  .zn-lightbox {
    padding: 52px 14px 46px;
  }

  .zn-lightbox__nav {
    width: 38px;
    height: 38px;
  }

  .zn-lightbox__nav--prev {
    left: 8px;
  }

  .zn-lightbox__nav--next {
    right: 8px;
  }

  .zn-lightbox__hint {
    display: none;
  }
}
</style>
