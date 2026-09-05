import { useEffect, useMemo, useState } from 'react';
import { Button, Switch, Toast, Typography } from '@douyinfe/semi-ui';
import { Save } from 'lucide-react';
import { DRIVE_ROLE_LABELS, DRIVE_SUBJECT_TYPE_LABELS, type DriveNode } from '@zenith/shared/drive';
import { useDriveNodePermissions, useSaveDriveNodePermissions, useSetDriveNodeInherit } from '@/hooks/queries/drive';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DriveSubjectPicker, type SubjectGrant } from './DriveSubjectPicker';
import { roleAtLeast } from '../drive-utils';

interface DrivePermissionPanelProps {
  readonly node: DriveNode;
}

/** 节点授权面板：当前有效角色摘要 + 继承来源 + 直接授权编辑 */
export function DrivePermissionPanel({ node }: DrivePermissionPanelProps) {
  const { hasPermission } = usePermission();
  const query = useDriveNodePermissions(node.id);
  const save = useSaveDriveNodePermissions();
  const setInherit = useSetDriveNodeInherit();
  const [draft, setDraft] = useState<SubjectGrant[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!query.data || dirty) return;
    setDraft(query.data.direct.map((p) => ({ subjectType: p.subjectType, subjectId: p.subjectId, role: p.role, subjectName: p.subjectName })));
  }, [query.data, dirty]);

  const canManage = useMemo(() => hasPermission('drive:node:grant') && roleAtLeast(query.data?.effectiveRole, 'manager'), [hasPermission, query.data?.effectiveRole]);

  const handleSave = async () => {
    await save.mutateAsync({ params: { id: node.id }, body: { permissions: draft.map(({ subjectType, subjectId, role }) => ({ subjectType, subjectId, role })) } });
    setDirty(false);
    Toast.success('授权已保存');
  };

  if (!query.data) return <Typography.Text type="tertiary">加载中…</Typography.Text>;
  const { effectiveRole, spaceRole, inherited, inheritPermissions } = query.data;

  return (
    <div className="drive-panel">
      <div className="drive-panel__summary">
        <div><span className="drive-panel__label">我的有效角色</span><strong>{effectiveRole ? DRIVE_ROLE_LABELS[effectiveRole] : EMPTY_PLACEHOLDER}</strong></div>
        <div><span className="drive-panel__label">空间角色</span>{spaceRole ? DRIVE_ROLE_LABELS[spaceRole] : EMPTY_PLACEHOLDER}</div>
        {node.type === 'folder' && (
          <div className="drive-panel__inherit">
            <span className="drive-panel__label">继承上级授权</span>
            <Switch size="small" checked={inheritPermissions} disabled={!canManage || setInherit.isPending}
              onChange={(checked) => setInherit.mutate({ params: { id: node.id }, body: { inherit: checked } }, { onSuccess: () => Toast.success(checked ? '已恢复继承' : '已断开继承，仅本目录授权与空间管理者可访问') })} />
          </div>
        )}
      </div>

      {inherited.length > 0 && (
        <section className="drive-panel__section">
          <Typography.Title heading={6}>继承自上级目录</Typography.Title>
          <ul className="drive-panel__inherited">
            {inherited.map((p) => (
              <li key={p.id}>
                <span>{DRIVE_SUBJECT_TYPE_LABELS[p.subjectType]} · {p.subjectName ?? `#${p.subjectId}`}</span>
                <span>{DRIVE_ROLE_LABELS[p.role]}</span>
                <Typography.Text type="tertiary" size="small">来自「{p.inheritedFrom?.name}」</Typography.Text>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="drive-panel__section">
        <div className="drive-panel__section-head">
          <Typography.Title heading={6}>直接授权</Typography.Title>
          {canManage && (
            <Button size="small" theme="solid" icon={<Save size={14} />} loading={save.isPending} disabled={!dirty} onClick={() => void handleSave()}>保存授权</Button>
          )}
        </div>
        <DriveSubjectPicker value={draft} disabled={!canManage} onChange={(next) => { setDraft(next); setDirty(true); }}
          emptyText={canManage ? '尚未直接授权，添加用户 / 部门 / 角色 / 用户组' : '暂无直接授权'} />
      </section>
    </div>
  );
}
