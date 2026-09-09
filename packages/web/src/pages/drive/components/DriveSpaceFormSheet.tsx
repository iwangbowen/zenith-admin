import { useEffect, useState } from 'react';
import { Form, SideSheet, Spin, Typography } from '@douyinfe/semi-ui';
import {
  DRIVE_ROLE_OPTIONS, type CreateDriveSpaceInput, type DriveRole, type DriveSpace, type UpdateDriveSpaceInput,
} from '@zenith/shared/drive';
import { ModalFooter } from '@/components/ModalFooter';
import { useEditModal } from '@/hooks/useEditModal';
import { useDriveSpaceDetail, useSaveDriveSpace } from '@/hooks/queries/drive';
import { DriveSubjectPicker, type SubjectGrant } from './DriveSubjectPicker';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';

interface SpaceFormValues {
  name: string;
  description?: string;
  defaultMemberRole: DriveRole | null;
  quotaGb: number | null;
  maxVersions: number | null;
  allowExternalShare: boolean;
  status: 'enabled' | 'disabled';
}

const ROLE_OPTIONS_WITH_NONE = [{ value: '', label: '不开放（仅成员可访问）' }, ...DRIVE_ROLE_OPTIONS];

/** `'create'` 新建；传空间行则编辑 */
export type DriveSpaceFormTarget = 'create' | DriveSpace;

interface DriveSpaceFormSheetProps {
  /** null 关闭 */
  readonly target: DriveSpaceFormTarget | null;
  readonly onClose: () => void;
}

/**
 * 协作空间新建 / 编辑抽屉，工作台「+」与共享空间列表共用。
 * 自持 `useEditModal`，由 `target` 驱动开合，保存成功后回调 `onClose` 让调用方清空 target。
 */
export function DriveSpaceFormSheet({ target, onClose }: DriveSpaceFormSheetProps) {
  const save = useSaveDriveSpace();
  const [newMembers, setNewMembers] = useState<SubjectGrant[]>([]);

  const modal = useEditModal<DriveSpace, SpaceFormValues, CreateDriveSpaceInput | UpdateDriveSpaceInput>({
    entityName: '协作空间',
    save,
    useDetail: useDriveSpaceDetail,
    defaults: { defaultMemberRole: null, quotaGb: null, maxVersions: null, allowExternalShare: true, status: 'enabled' },
    toValues: (s) => ({
      name: s.name, description: s.description ?? undefined, defaultMemberRole: s.defaultMemberRole,
      quotaGb: s.customQuotaBytes === null ? null : Math.round(s.customQuotaBytes / 1024 ** 3 * 100) / 100,
      maxVersions: s.maxVersions, allowExternalShare: s.allowExternalShare, status: s.status as 'enabled' | 'disabled',
    }),
    beforeSave: (values, ctx) => {
      const payload = {
        ...values,
        description: values.description || undefined,
        defaultMemberRole: (values.defaultMemberRole as DriveRole | '' | null) || null,
        quotaGb: values.quotaGb ?? null,
        maxVersions: values.maxVersions ?? null,
      };
      return ctx.isEdit ? payload : { ...payload, sort: 0, members: newMembers.map(({ subjectType, subjectId, role }) => ({ subjectType, subjectId, role })) };
    },
    onSaved: () => { setNewMembers([]); onClose(); },
    labelWidth: 110,
  });

  const { openCreate, openEdit, close: closeModal } = modal;
  useEffect(() => {
    if (target === null) { closeModal(); return; }
    if (target === 'create') { setNewMembers([]); openCreate(); } else openEdit(target);
  }, [target, openCreate, openEdit, closeModal]);

  const close = () => { closeModal(); onClose(); };

  return (
    <SideSheet title={modal.modalProps.title} visible={modal.visible} onCancel={close} closeOnEsc width={640}
      footer={<ModalFooter {...modal.footerProps} okText="保存" />}>
      <Spin spinning={modal.detailLoading}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="name" label="空间名称" rules={[{ required: true, message: '请输入空间名称' }, { max: 100 }]} />
          <Form.TextArea field="description" label="描述" maxCount={300} rows={2} />
          <Form.Select field="defaultMemberRole" label="默认成员角色" optionList={ROLE_OPTIONS_WITH_NONE} style={{ width: '100%' }}
            extraText="为空表示只有下方协作者可访问；设置后全体登录用户按该角色访问" />
          <Form.InputNumber field="quotaGb" label="配额 (GB)" min={0} precision={2} placeholder="留空跟随系统默认" style={{ width: 200 }} />
          <Form.InputNumber field="maxVersions" label="最多版本数" min={1} max={200} placeholder="留空跟随系统默认" style={{ width: 200 }} />
          <Form.Switch field="allowExternalShare" label="允许外链分享" />
          {modal.isEdit && <FormStatusRadioGroup type="button" />}
        </Form>
        {!modal.isEdit && (
          <div style={{ marginTop: 8 }}>
            <Typography.Title heading={6} style={{ margin: '8px 0' }}>初始协作者</Typography.Title>
            <DriveSubjectPicker value={newMembers} onChange={setNewMembers} emptyText="可稍后在「成员管理」中添加" />
          </div>
        )}
      </Spin>
    </SideSheet>
  );
}
