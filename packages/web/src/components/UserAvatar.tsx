import { Avatar } from '@douyinfe/semi-ui';

/** 根据名称字符串生成稳定的背景色（循环取 Semi 语义色） */
function getAvatarColor(name: string): string {
  const colors = [
    'var(--semi-color-primary)',
    'var(--semi-color-success)',
    'var(--semi-color-warning)',
    'var(--semi-color-danger)',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

interface UserAvatarProps {
  /** 用户昵称，用于生成首字母和背景色 */
  name: string;
  /** 头像图片 URL，有值时显示图片 */
  avatar?: string | null;
  /** 像素尺寸，默认 36；传 null 时不内联宽高，交由外部 CSS 类控制（如响应式尺寸） */
  size?: number | null;
  /** 传递给 Avatar 的额外 className */
  className?: string;
  /** 传递给 Avatar 的额外 style */
  style?: React.CSSProperties;
  /** Semi Avatar size 预设，不传时用 size 数值控制 */
  semiSize?: 'extra-extra-small' | 'extra-small' | 'small' | 'default' | 'medium' | 'large' | 'extra-large';
}

/**
 * 通用用户头像组件。
 * - 有 avatar URL → 显示图片
 * - 无头像 → 显示首字母 + 哈希背景色
 */
export function UserAvatar({ name, avatar, size = 36, className, style, semiSize = 'small' }: Readonly<UserAvatarProps>) {
  const { fontSize, ...restStyle } = style ?? {};
  const sizeStyle: React.CSSProperties = size === null
    ? { flexShrink: 0, ...restStyle }
    : { width: size, height: size, flexShrink: 0, ...restStyle };

  if (avatar) {
    return (
      <Avatar
        src={avatar}
        alt={name}
        size={semiSize}
        className={className}
        style={sizeStyle}
      />
    );
  }

  const letter = name.slice(0, 1).toUpperCase() || '?';
  return (
    <Avatar
      size={semiSize}
      alt={name}
      className={className}
      style={{ backgroundColor: getAvatarColor(name), color: '#fff', ...sizeStyle }}
    >
      {fontSize === undefined ? letter : (
        // Semi 按 size 预设给 .semi-avatar-label 定死字号，根节点的 fontSize 传不下去；
        // 自行渲染 label（复用其类名保留粗体与居中、补回 role / aria-label），用内联字号压过预设
        <span role="img" aria-label={name} className="semi-avatar-label" style={{ fontSize }}>{letter}</span>
      )}
    </Avatar>
  );
}
