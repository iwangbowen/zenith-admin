<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()

const formattedDate = computed<string>(() => {
  const ts = page.value.lastUpdated
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

const isoDate = computed<string>(() => {
  const ts = page.value.lastUpdated
  if (!ts) return ''
  return new Date(ts).toISOString()
})
</script>

<template>
  <div v-if="formattedDate" class="zn-last-updated">
    <span class="label">最后更新于</span>
    <time :datetime="isoDate">{{ formattedDate }}</time>
  </div>
</template>

<style scoped>
.zn-last-updated {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.label {
  color: var(--vp-c-text-2);
}
</style>
