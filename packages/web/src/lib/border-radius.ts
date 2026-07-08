import type { BorderRadiusPreference } from '@/hooks/usePreferences';

/**
 * 全局圆角偏好：通过在 body 上内联覆盖 Semi Design 圆角 token 生效，
 * 可同时作用于 Portal 渲染的弹层（Modal / Popover / Toast 等）。
 * Semi 默认值：extra-small 3px / small 3px / medium 6px / large 12px。
 */
const RADIUS_TOKENS = ['extra-small', 'small', 'medium', 'large'] as const;

const RADIUS_PRESETS: Record<Exclude<BorderRadiusPreference, 'medium'>, readonly [number, number, number, number]> = {
  none: [0, 0, 0, 0],
  small: [2, 2, 3, 6],
  large: [6, 6, 10, 16],
};

export function applyBorderRadius(pref: BorderRadiusPreference) {
  const preset = pref === 'medium' ? null : RADIUS_PRESETS[pref];
  RADIUS_TOKENS.forEach((token, i) => {
    const prop = `--semi-border-radius-${token}`;
    if (preset) {
      document.body.style.setProperty(prop, `${preset[i]}px`);
    } else {
      // medium = Semi 默认，移除覆盖回退到样式表定义值
      document.body.style.removeProperty(prop);
    }
  });
}
