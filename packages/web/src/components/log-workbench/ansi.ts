/**
 * ANSI SGR 转义序列解析：主机日志（nginx / systemd / 容器输出）可能带终端颜色，
 * 搜索与级别识别在去色文本上进行，渲染时再按片段着色。
 */

// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

const ANSI_FG = ['#3c3c3c', '#c0392b', '#27ae60', '#d4ac0d', '#2980b9', '#8e44ad', '#17a589', '#bdc3c7'];
const ANSI_FG_BRIGHT = ['#7f8c8d', '#e74c3c', '#2ecc71', '#f1c40f', '#3498db', '#9b59b6', '#1abc9c', '#ecf0f1'];

export interface AnsiSpan {
  text: string;
  color?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
}

export function hasAnsi(text: string): boolean {
  return text.includes('\x1b[');
}

/** 去除所有 SGR 转义序列（用于关键词匹配、级别识别、复制与导出） */
export function stripAnsi(text: string): string {
  return hasAnsi(text) ? text.replaceAll(ANSI_SGR_RE, '') : text;
}

/** 按 SGR 码把一行拆成带样式的片段；片段文本拼接即去色文本 */
export function parseAnsi(raw: string): AnsiSpan[] {
  const result: AnsiSpan[] = [];
  let color: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let italic = false;
  let dim = false;
  // eslint-disable-next-line no-control-regex
  const segments = raw.split(/(\x1b\[[0-9;]*m)/);
  for (const seg of segments) {
    if (seg.startsWith('\x1b[') && seg.endsWith('m')) {
      const codes = seg.slice(2, -1).split(';').map(Number);
      for (const code of codes) {
        if (code === 0) { color = undefined; bg = undefined; bold = false; italic = false; dim = false; }
        else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 3) italic = true;
        else if (code === 22) { bold = false; dim = false; }
        else if (code === 23) italic = false;
        else if (code === 39) color = undefined;
        else if (code === 49) bg = undefined;
        else if (code >= 30 && code <= 37) color = ANSI_FG[code - 30];
        else if (code >= 90 && code <= 97) color = ANSI_FG_BRIGHT[code - 90];
        else if (code >= 40 && code <= 47) bg = ANSI_FG[code - 40];
      }
    } else if (seg) {
      result.push({ text: seg, color, bg, bold: bold || undefined, italic: italic || undefined, dim: dim || undefined });
    }
  }
  return result;
}
