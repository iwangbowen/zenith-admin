/**
 * 审批单验真页（公开、无脚本、noindex）。
 * 只呈现单据身份与终态事实，不含表单内容与参与人，二维码令牌由 workflow-print.service 签发与校验。
 */
import { escapeHtml } from '@zenith/shared/core';
import type { PrintVerifyView } from '../../../services/workflow/workflow-print.service';

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f5f7;color:#1f2329;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:36px 32px;max-width:460px;width:calc(100% - 48px)}
  .badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600}
  .ok{background:#e8f5ec;color:#1f7a3d}
  .bad{background:#fdecec;color:#c62828}
  h1{font-size:18px;margin:14px 0 6px}
  p{font-size:14px;color:#646a73;margin:0 0 18px;line-height:1.6}
  dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:14px}
  dt{color:#8f959e;white-space:nowrap}
  dd{margin:0;word-break:break-all}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .foot{margin-top:22px;font-size:12px;color:#8f959e;line-height:1.6}
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function row(label: string, value: string | null | undefined, mono = false): string {
  if (!value) return '';
  const text = escapeHtml(value);
  return `<dt>${escapeHtml(label)}</dt><dd>${mono ? `<code>${text}</code>` : text}</dd>`;
}

export function renderPrintVerifyPage(view: PrintVerifyView): string {
  if (!view.valid) {
    return shell('验真失败', `
<span class="badge bad">无法验证</span>
<h1>该二维码无效</h1>
<p>令牌无法识别或对应的审批单已不存在。请确认打印件来源，必要时联系单据发起人。</p>`);
  }
  const archived = view.archive
    ? `<p class="foot">系统已在 ${escapeHtml(view.archive.archivedAt)} 生成归档原件，SHA-256：<code>${escapeHtml(view.archive.sha256)}</code>。可将手中 PDF 文件的校验值与此比对。</p>`
    : '<p class="foot">该审批单尚未生成归档原件；本页信息以系统当前记录为准。</p>';
  return shell(`审批单验真 · ${view.serialNo ?? view.title ?? ''}`, `
<span class="badge ok">系统签发</span>
<h1>${escapeHtml(view.title ?? '审批单')}</h1>
<p>以下为系统实时记录，可用于核对纸质 / PDF 打印件。</p>
<dl>
${row('单号', view.serialNo, true)}
${row('流程', view.definitionName)}
${row('状态', view.statusText)}
${row('发起时间', view.createdAt)}
${row('办结时间', view.finishedAt)}
</dl>
${archived}`);
}
