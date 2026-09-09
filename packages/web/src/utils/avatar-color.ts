const AVATAR_COLORS = [
  'var(--semi-color-primary)',
  'var(--semi-color-success)',
  'var(--semi-color-warning)',
  'var(--semi-color-danger)',
];

/** 根据名称字符串生成稳定的头像背景色（循环取 Semi 语义色）；用户头像与聊天群头像九宫格共用同一映射 */
export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
