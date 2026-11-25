import { useEffect, useRef, useState } from 'react';
import { SideSheet } from '@douyinfe/semi-ui';
import ModalFooter from '@/components/ModalFooter';
import { PermissionScopeWorkspace } from './PermissionScopeWorkspace';
import { usePermissionScopeDraft } from './usePermissionScopeDraft';
import { normalizeScopeValue, type PermissionScopeData, type PermissionScopeValue } from './scope-types';

type Props = Readonly<{
  visible: boolean;
  title?: string;
  data: PermissionScopeData;
  initialValue: PermissionScopeValue;
  coveredPermissionCodes?: string[];
  loading?: boolean;
  width?: string | number;
  onCancel: () => void;
  onApply: (value: PermissionScopeValue) => void;
}>;

/**
 * 选择授权范围的 SideSheet 壳。
 *
 * 草稿在抽屉内部维护：点“应用选择”才回写宿主，取消不会污染表单。
 */
export function PermissionScopeDrawer({
  visible,
  title = '选择授权范围',
  data,
  initialValue,
  coveredPermissionCodes = [],
  loading = false,
  width,
  onCancel,
  onApply,
}: Props) {
  const scope = usePermissionScopeDraft(initialValue);
  const { reset } = scope;
  const opened = useRef(false);
  const [panelHeight, setPanelHeight] = useState(480);

  useEffect(() => {
    if (visible && !opened.current) {
      reset(normalizeScopeValue(initialValue));
      opened.current = true;
    }
    if (!visible) opened.current = false;
  }, [initialValue, reset, visible]);

  useEffect(() => {
    if (!visible) return;
    const sync = () => setPanelHeight(Math.max(320, Math.min(640, window.innerHeight - 300)));
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [visible]);

  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onCancel}
      width={width ?? 'min(1280px, 94vw)'}
      bodyStyle={{ padding: 0, overflow: 'hidden' }}
      footer={<ModalFooter onCancel={onCancel} onOk={() => onApply(scope.value)} okText="应用选择" />}
    >
      <div style={{ height: '100%', padding: 16, overflow: 'auto' }}>
        <PermissionScopeWorkspace
          data={data}
          value={scope.value}
          onChange={scope.setValue}
          loading={loading}
          height={panelHeight}
          coveredPermissionCodes={coveredPermissionCodes}
          showPolicy
        />
      </div>
    </SideSheet>
  );
}
