import { AppModal } from '@/components/AppModal';

/** 系统内置预设头像列表（public/avatars/avatar-01..12.svg） */
const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

interface PresetAvatarPickerModalProps {
  readonly visible: boolean;
  /** 当前头像地址，用于高亮选中项 */
  readonly currentAvatar?: string | null;
  readonly onCancel: () => void;
  readonly onSelect: (url: string) => void;
}

/** 预设头像选择弹窗（个人中心与用户管理头像维护共用） */
export function PresetAvatarPickerModal({ visible, currentAvatar, onCancel, onSelect }: PresetAvatarPickerModalProps) {
  return (
    <AppModal
      title="选择预设头像"
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={460}
      centered
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '8px 0 16px' }}>
        {PRESET_AVATARS.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => onSelect(url)}
            style={{
              border: currentAvatar === url ? '2px solid var(--semi-color-primary)' : '2px solid transparent',
              borderRadius: 'var(--semi-border-radius-medium)', padding: 4, cursor: 'pointer', background: 'var(--semi-color-fill-0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => { if (currentAvatar !== url) e.currentTarget.style.borderColor = 'var(--semi-color-primary-light-hover)'; }}
            onMouseLeave={(e) => { if (currentAvatar !== url) e.currentTarget.style.borderColor = 'transparent'; }}
          >
            <img src={url} alt="预设头像" width={72} height={72} style={{ borderRadius: 'var(--semi-border-radius-small)', display: 'block' }} loading="lazy" />
          </button>
        ))}
      </div>
    </AppModal>
  );
}
