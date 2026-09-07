<template>
  <div class="za drive-art" aria-hidden="true">
    <div class="drive-art__spaces">
      <span class="za-chip">个人</span>
      <span class="za-chip za-chip--on">部门空间</span>
      <span class="za-chip">协作</span>
    </div>
    <div class="drive-art__folder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3Z" />
      </svg>
      <strong>项目资料</strong>
      <span>仅成员可访问</span>
    </div>
    <div class="drive-art__file">
      <span>项目方案.pdf</span>
      <span class="za-chip">v3</span>
    </div>
    <div class="drive-art__footer"><span>版本历史</span><span>受控分享</span><span>回收站</span></div>
  </div>
</template>

<style scoped>
.drive-art { display: grid; gap: 12px; }
.drive-art__spaces, .drive-art__folder, .drive-art__file, .drive-art__footer { display: flex; align-items: center; gap: 8px; }
.drive-art__spaces, .drive-art__footer { flex-wrap: wrap; }
.drive-art__folder svg { width: 24px; height: 24px; flex: none; color: var(--vp-c-brand-1); }
.drive-art__folder strong, .drive-art__file > span:first-child { flex: 1; min-width: 0; }
.drive-art__folder > span, .drive-art__footer { color: var(--zn-text-2); font-size: 11px; }
.drive-art__file { padding: 8px 0 8px 32px; font-size: 12px; }
.drive-art__footer { justify-content: space-between; }
</style>
