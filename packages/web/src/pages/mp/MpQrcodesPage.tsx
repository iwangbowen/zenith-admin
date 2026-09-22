import { useState } from 'react';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { Button, Form, Image, Select, Tag, Typography } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import { MP_QRCODE_TYPE_OPTIONS, type CreateMpQrcodeInput, type MpQrcode, type MpQrcodeType, mpQrcodeContract } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { EMPTY_PLACEHOLDER, createdAtColumn, renderCodeEllipsis, renderEllipsis } from '@/utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { useCreateMpQrcode, useDeleteMpQrcodes, useMpQrcodeList } from '@/hooks/queries/mp-qrcodes';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { useListPage } from '@/hooks/useListPage';

const TYPE_META: Record<MpQrcodeType, { label: string; color: 'green' | 'orange' }> = {
  permanent: { label: '永久', color: 'green' },
  temporary: { label: '临时', color: 'orange' },
};
type QrcodeFormValues = Pick<CreateMpQrcodeInput, 'sceneStr' | 'name' | 'expireSeconds' | 'rewardPoints'>;

export default function MpQrcodesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const page = useListPage({
    contract: mpQrcodeContract,
    resetKey: currentId,
    useList: useMpQrcodeList,
    params: { accountId: currentId ?? 0 },
    enabled: !!currentId,
  });
  const { tableProps } = page;

  const [modalType, setModalType] = useState<MpQrcodeType>('permanent');

  const createMutation = useCreateMpQrcode();
  const deleteMutation = useDeleteMpQrcodes();
  const createModal = useEditModal<MpQrcode, QrcodeFormValues, Partial<CreateMpQrcodeInput>>({
    save: createMutation,
    defaults: { sceneStr: '', name: '', expireSeconds: 604800, rewardPoints: 0 },
    beforeSave: (values) => {
      if (!currentId) abortSubmit('validation');
      const payload: Partial<CreateMpQrcodeInput> = {
        accountId: currentId,
        type: modalType,
        sceneStr: values.sceneStr,
        name: values.name,
      };
      if (modalType === 'temporary') payload.expireSeconds = values.expireSeconds;
      payload.rewardPoints = values.rewardPoints ?? 0;
      return payload;
    },
    successMessage: () => '生成成功',
    // 最长标签「扫码奖励积分」6 字约 84px，默认 labelWidth 90 减去标签内边距后装不下会折行
    labelWidth: 110,
  });

  const openCreate = () => { setModalType('permanent'); createModal.openCreate(); };

  const columns = [
    { title: '名称', dataIndex: 'name', minWidth: 160, render: renderEllipsis },
    // 场景值是字母/数字/下划线/连字符标识（上限 64 字符），等宽字体单行省略 + tooltip；
    // 240 定宽（可用 208）能完整容纳种子里的 channel_offline_store（约 176px），原 180 会折行
    { title: '场景值', dataIndex: 'sceneStr', width: 240, render: renderCodeEllipsis },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: MpQrcodeType) => <Tag color={TYPE_META[v].color} type="light">{TYPE_META[v].label}</Tag> },
    { title: '扫码次数', dataIndex: 'scanCount', width: 100, align: 'center' as const },
    { title: '奖励积分', dataIndex: 'rewardPoints', width: 100, align: 'center' as const, render: (v: number) => (v > 0 ? <Typography.Text type="success">+{v}</Typography.Text> : EMPTY_PLACEHOLDER) },
    {
      title: '二维码', dataIndex: 'url', width: 90, align: 'center' as const,
      render: (v: string | null) => (v
        ? <Image src={v} width={48} height={48} style={{ borderRadius: 'var(--semi-border-radius-small)' }} />
        : EMPTY_PLACEHOLDER),
    },
    createdAtColumn,
    createOperationColumn<MpQrcode>({
      width: 100,
      desktopInlineKeys: ['delete'],
      menuAriaLabel: '二维码操作',
      actions: (record) => [
        deleteAction({
          hidden: !can('mp:qrcode:delete'),
          title: '确定要删除该二维码吗？',
          content: '删除后本地记录移除，已投放的二维码图片仍可能被扫描。',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'type']}
        extraFilters={<MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />}
        create={(
          can('mp:qrcode:create') ? (
            <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>生成二维码</Button>
          ) : null
        )}
        filterTitle="二维码筛选"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable columns={columns}
        {...tableProps}
      />

      <AppModal {...createModal.modalProps} title="生成带参二维码" width={560}>
                <Form
          {...createModal.formProps}
          key={`${createModal.formKey}-${modalType}`}
        >
          <Form.Slot label="二维码类型">
            <Select style={{ width: '100%' }} optionList={MP_QRCODE_TYPE_OPTIONS} value={modalType} onChange={(v) => setModalType(v as MpQrcodeType)} />
          </Form.Slot>
          <Form.Input field="name" label="名称" placeholder="如：线下门店物料"
            rules={[{ required: true, message: '请输入名称' }]} maxLength={100} />
          <Form.Input field="sceneStr" label="场景值" placeholder="渠道标识，仅字母/数字/下划线/连字符"
            rules={[{ required: true, message: '请输入场景值' }, { pattern: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、下划线、连字符' }]} maxLength={64} />
          {modalType === 'temporary' && (
            <Form.InputNumber field="expireSeconds" label="有效期(秒)" style={{ width: '100%' }} min={60} max={2592000} step={60}
              rules={[{ required: true, message: '请设置有效期' }]} />
          )}
          <Form.InputNumber field="rewardPoints" label="扫码奖励积分" style={{ width: '100%' }} min={0} max={100000}
            extraText="扫码关注的粉丝若已绑定会员，自动入账该积分；0 表示不奖励" />
        </Form>
      </AppModal>
    </div>
  );
}
