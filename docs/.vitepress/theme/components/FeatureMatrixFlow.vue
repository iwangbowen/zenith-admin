<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, withBase } from 'vitepress'
import { gsap } from 'gsap'

const baseItems = [
  '用户 / 角色 / 菜单权限',
  '按钮级鉴权',
  '部门与岗位管理',
  '字典与字典项',
  '公告通知',
  '消息中心（单聊 / 群聊）',
  '会话置顶与收藏',
  '消息搜索',
  'WebSocket 实时收发',
  '登录日志',
  '操作日志',
  '在线会话管理',
  'Redis 会话持久化',
  '强制下线黑名单',
  'JWT 双 Token 鉴权',
  'Refresh 自动续期',
  '系统配置中心',
  '定时任务管理',
  '数据库备份',
  '文件管理',
  '存储后端切换（local / OSS / S3 / COS）',
  'OAuth 配置',
  'API Token',
  'OpenAPI 文档',
  'Drizzle 迁移管理',
  '可选多租户隔离',
  '租户视角切换',
  '统一响应结构',
]

const laneSpeeds = [22, 26, 24]
const laneOffsets = [0, 14, 28]

const laneCount = ref(3)

const laneItems = computed(() => {
  const lanes = Array.from({ length: laneCount.value }, () => [] as string[])
  for (let i = 0; i < baseItems.length; i += 1) {
    lanes[i % laneCount.value].push(baseItems[i])
  }
  return lanes
})

const loopLaneItems = computed(() => laneItems.value.map((lane) => [...lane, ...lane]))
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${laneCount.value}, minmax(0, 1fr))`,
}))

const viewportRef = ref<HTMLElement | null>(null)
const laneRefs = ref<HTMLElement[]>([])
const lineRefs = ref<HTMLElement[][]>([])

let ctx: gsap.Context | null = null
let tweens: gsap.core.Tween[] = []
let resizeObserver: ResizeObserver | null = null

const setLaneRef = (el: Element | null, laneIndex: number) => {
  if (!el) return
  laneRefs.value[laneIndex] = el as HTMLElement
}

const setLineRef = (el: Element | null, laneIndex: number, lineIndex: number) => {
  if (!el) return
  if (!lineRefs.value[laneIndex]) {
    lineRefs.value[laneIndex] = []
  }
  lineRefs.value[laneIndex][lineIndex] = el as HTMLElement
}

const updateLaneVisualState = (laneIndex: number) => {
  const lane = laneRefs.value[laneIndex]
  const lines = lineRefs.value[laneIndex]
  if (!lane || lines.length === 0) return

  const laneRect = lane.getBoundingClientRect()
  const centerY = laneRect.top + laneRect.height / 2
  const maxDistance = laneRect.height / 2

  for (const el of lines) {
    const rect = el.getBoundingClientRect()
    const lineCenter = rect.top + rect.height / 2
    const distance = Math.abs(lineCenter - centerY)
    const ratio = Math.min(distance / maxDistance, 1)

    const scale = 1.15 - ratio * 0.43
    const opacity = 0.98 - ratio * 0.52
    const blur = ratio * 1.9

    gsap.set(el, {
      scale,
      opacity,
      filter: `blur(${blur}px)`,
      transformOrigin: '50% 50%',
    })
  }
}

const updateAllLanesVisualState = () => {
  for (let laneIndex = 0; laneIndex < laneCount.value; laneIndex += 1) {
    updateLaneVisualState(laneIndex)
  }
}

const resolveLaneCount = (width: number) => {
  const minLaneWidth = 260
  const laneGap = 10
  const next = Math.floor((width + laneGap) / (minLaneWidth + laneGap))
  return Math.max(1, Math.min(3, next))
}

const updateLaneCountByWidth = (width: number) => {
  const next = resolveLaneCount(width)
  if (next === laneCount.value) {
    updateAllLanesVisualState()
    return
  }

  laneCount.value = next
}

const pauseLane = (laneIndex: number) => {
  tweens[laneIndex]?.pause()
}

const resumeLane = (laneIndex: number) => {
  tweens[laneIndex]?.resume()
}

const router = useRouter()

const goToFeaturesPage = () => {
  router.go(withBase('/product/features'))
}

const initAnimation = () => {
  const viewport = viewportRef.value
  if (!viewport) return

  ctx?.revert()
  ctx = gsap.context(() => {
    tweens.forEach((tween) => tween.kill())
    tweens = []

    lineRefs.value = Array.from({ length: laneCount.value }, (_unused, laneIndex) => lineRefs.value[laneIndex] ?? [])

    for (let laneIndex = 0; laneIndex < laneCount.value; laneIndex += 1) {
      const lines = lineRefs.value[laneIndex]
      const sourceLength = laneItems.value[laneIndex]?.length ?? 0
      if (!lines || lines.length === 0 || sourceLength === 0) continue

      const step = 46
      const singleLength = step * sourceLength
      const totalLength = singleLength * 2

      gsap.set(lines, {
        y: (lineIndex) => lineIndex * step - singleLength + laneOffsets[laneIndex % laneOffsets.length],
        willChange: 'transform, filter, opacity',
      })

      updateLaneVisualState(laneIndex)

      const laneTween = gsap.to(lines, {
        y: `+=${singleLength}`,
        duration: laneSpeeds[laneIndex % laneSpeeds.length],
        ease: 'none',
        repeat: -1,
        modifiers: {
          y: (value) => {
            const y = Number.parseFloat(value)
            const wrapped = ((y + totalLength) % totalLength) - singleLength
            return `${wrapped}px`
          },
        },
        onUpdate: () => updateLaneVisualState(laneIndex),
      })

      tweens[laneIndex] = laneTween
    }
  }, viewport)
}

onMounted(async () => {
  await nextTick()

  const viewport = viewportRef.value
  if (!viewport) return

  updateLaneCountByWidth(viewport.clientWidth)
  await nextTick()
  initAnimation()

  resizeObserver = new ResizeObserver((entries) => {
    const first = entries[0]
    if (!first) return
    updateLaneCountByWidth(first.contentRect.width)
  })
  resizeObserver.observe(viewport)

  window.addEventListener('resize', updateAllLanesVisualState)
})

watch(laneCount, async () => {
  await nextTick()
  initAnimation()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', updateAllLanesVisualState)
  tweens.forEach((tween) => tween.kill())
  tweens = []
  ctx?.revert()
  ctx = null
})
</script>

<template>
  <div
    class="zn-feature-flow"
    ref="viewportRef"
    aria-label="核心能力滚动列表，点击跳转到功能模块"
    role="link"
    tabindex="0"
    @click="goToFeaturesPage"
    @keydown.enter.prevent="goToFeaturesPage"
    @keydown.space.prevent="goToFeaturesPage"
  >
    <div class="zn-feature-flow__grid" :style="gridStyle">
      <div
        v-for="(lane, laneIndex) in loopLaneItems"
        :key="`lane-${laneIndex}`"
        class="zn-feature-flow__lane"
        :ref="(el) => setLaneRef(el, laneIndex)"
        @mouseenter="pauseLane(laneIndex)"
        @mouseleave="resumeLane(laneIndex)"
      >
        <div class="zn-feature-flow__mask" />
        <div
          v-for="(item, lineIndex) in lane"
          :key="`${item}-${laneIndex}-${lineIndex}`"
          class="zn-feature-flow__item"
          :ref="(el) => setLineRef(el, laneIndex, lineIndex)"
          :aria-hidden="lineIndex >= laneItems[laneIndex].length"
        >
          {{ item }}
        </div>
      </div>
    </div>
    <div class="zn-feature-flow__hint" aria-hidden="true">点击查看功能模块 →</div>
  </div>
</template>

<style scoped>
.zn-feature-flow {
  border: 1px solid var(--zn-border);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  padding: 14px;
  cursor: pointer;
}

.zn-feature-flow:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--vp-c-brand-1) 65%, transparent);
  outline-offset: 3px;
}

.dark .zn-feature-flow {
  background: var(--zn-bg-alt);
}

.zn-feature-flow__grid {
  display: grid;
  gap: 10px;
}

.zn-feature-flow__lane {
  position: relative;
  overflow: hidden;
  height: 300px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 85%, var(--vp-c-bg));
}

.dark .zn-feature-flow__lane {
  background: color-mix(in srgb, var(--zn-bg-alt) 84%, #000);
}

.zn-feature-flow__item {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--zn-text-1);
  letter-spacing: 0.1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-inline: 8px;
}

.zn-feature-flow__hint {
  margin-top: 8px;
  text-align: right;
  font-size: 12px;
  color: var(--zn-text-2);
}

.zn-feature-flow__mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  background: linear-gradient(
    180deg,
    var(--vp-c-bg-soft) 0%,
    color-mix(in srgb, var(--vp-c-bg-soft) 40%, transparent) 12%,
    transparent 30%,
    transparent 70%,
    color-mix(in srgb, var(--vp-c-bg-soft) 40%, transparent) 88%,
    var(--vp-c-bg-soft) 100%
  );
}

.dark .zn-feature-flow__mask {
  background: linear-gradient(
    180deg,
    var(--zn-bg-alt) 0%,
    color-mix(in srgb, var(--zn-bg-alt) 42%, transparent) 12%,
    transparent 30%,
    transparent 70%,
    color-mix(in srgb, var(--zn-bg-alt) 42%, transparent) 88%,
    var(--zn-bg-alt) 100%
  );
}

@media (max-width: 640px) {
  .zn-feature-flow {
    padding: 10px;
  }

  .zn-feature-flow__lane {
    height: 230px;
  }

  .zn-feature-flow__item {
    font-size: 13px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .zn-feature-flow__lane {
    height: auto;
    max-height: 280px;
    overflow: auto;
  }

  .zn-feature-flow__item {
    position: static;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
    padding-block: 4px;
  }

  .zn-feature-flow__mask {
    display: none;
  }
}
</style>
