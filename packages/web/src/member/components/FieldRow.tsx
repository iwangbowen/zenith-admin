import type { ReactNode } from 'react';

/** 会员前台表单行：左标签、右控件（`mc-field-*` 样式），个人资料 / 修改密码等页共用 */
export function FieldRow({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="mc-field-row">
      <div className="mc-field-label">{label}</div>
      <div className="mc-field-value">{children}</div>
    </div>
  );
}
