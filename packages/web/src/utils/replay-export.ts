/**
 * 回放导出：生成自包含 HTML（内嵌 rrweb-player UMD 资源与事件流），
 * 可直接发给无系统权限的人在浏览器打开播放。
 */
import { Toast } from '@douyinfe/semi-ui';
import type { ReplaySegmentMeta } from '@zenith/shared/analytics';
import { fetchReplaySegmentEvents } from '@/hooks/queries/session-replays';
import { downloadBlob } from '@/utils/download';

export async function exportReplayHtml(replayId: string, title: string, segments: ReplaySegmentMeta[]): Promise<void> {
  if (segments.length === 0) {
    Toast.warning('该回放没有可导出的录像分片');
    return;
  }
  const [playerJs, playerCss, chunks] = await Promise.all([
    // 相对路径直取文件绕过包 exports 封锁（rrweb-player 仅导出 '.' 与 './dist/style.css'）
    import('../../../../node_modules/rrweb-player/dist/rrweb-player.umd.min.cjs?raw').then((m) => m.default),
    import('rrweb-player/dist/style.css?raw').then((m) => m.default),
    Promise.all(segments.map((seg) => fetchReplaySegmentEvents(replayId, seg.seq))),
  ]);
  if (chunks.some(chunk => chunk.length === 0)) throw new Error('录像分片缺失或读取失败，请重试');
  const events = chunks.flat();
  const safeTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  if (events.length < 2) {
    Toast.warning('回放事件不足，无法导出');
    return;
  }
  // </script> 注入防御：事件文本中的闭合标签会破坏宿主 HTML
  const eventsJson = JSON.stringify(events).replaceAll('<', String.raw`\u003c`);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>会话回放 · ${safeTitle}</title>
<style>${playerCss}</style>
<style>
  body { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; background: #f5f5f5; font-family: system-ui, sans-serif; }
  h1 { font-size: 15px; color: #333; margin: 0; }
  .meta { font-size: 12px; color: #888; }
</style>
</head>
<body>
<h1>会话回放 · ${safeTitle}</h1>
<p class="meta">回放 ID：${replayId} · 导出时间：${new Date().toLocaleString()} · 本文件自包含，可离线播放</p>
<div id="player"></div>
<script>${playerJs}</script>
<script>
  var events = ${eventsJson};
  var Player = window.rrwebPlayer && (window.rrwebPlayer.default || window.rrwebPlayer);
  new Player({
    target: document.getElementById('player'),
    props: { events: events, width: Math.min(1024, window.innerWidth - 48), autoPlay: false, skipInactive: true },
  });
</script>
</body>
</html>`;
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `replay-${replayId.slice(0, 8)}.html`);
  Toast.success('回放已导出为自包含 HTML');
}
