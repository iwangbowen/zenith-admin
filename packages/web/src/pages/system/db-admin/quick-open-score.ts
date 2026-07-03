export interface QuickOpenTable {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'matview';
  comment: string | null;
}

/** 模糊匹配打分：连续子串 > 前缀 > 分段命中 > 稀疏子序列；返回 null 表示不匹配 */
export function quickOpenScore(query: string, table: QuickOpenTable): number | null {
  const q = query.toLowerCase();
  if (!q) return 0;
  const name = table.name.toLowerCase();
  const full = `${table.schema}.${table.name}`.toLowerCase();
  const comment = (table.comment ?? '').toLowerCase();

  if (name === q) return 1000;
  if (name.startsWith(q)) return 800 - name.length;
  const nameIdx = name.indexOf(q);
  if (nameIdx >= 0) return 600 - nameIdx;
  if (full.includes(q)) return 400;
  // 分词命中：user log → cron_user_logs（所有词都出现）
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => full.includes(w) || comment.includes(w))) return 300;
  if (comment.includes(q)) return 200;
  // 稀疏子序列（ucl → user_cron_logs）
  let i = 0;
  for (const ch of name) {
    if (ch === q[i]) i++;
    if (i === q.length) return 100 - name.length;
  }
  return null;
}
