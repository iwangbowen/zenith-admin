import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Settings } from 'lucide-react';
import type { CheckinRule, UpdateCheckinSettingsInput } from '@zenith/shared/member';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import {
  memberAdminKeys,
  useCheckinRules,
  useCheckinSettings,
  useDeleteCheckinRule,
  useSaveCheckinRule,
  useSaveCheckinSettings,
  type CheckinRuleFormValues,
} from '@/hooks/queries/member-admin';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

export default function CheckinRulesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const settingsFormApi = useRef<FormApi | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const listQuery = useCheckinRules();
  const settingsQuery = useCheckinSettings(settingsVisible);
  const data = listQuery.data ?? [];
  const settings = settingsQuery.data ?? null;
  const saveSettingsMutation = useSaveCheckinSettings();
  const saveRuleMutation = useSaveCheckinRule();
  const deleteRuleMutation = useDeleteCheckinRule();

  const openSettings = () => setSettingsVisible(true);

  const handleSaveSettings = async () => {
    let values: UpdateCheckinSettingsInput | undefined;
    try {
      values = await settingsFormApi.current!.validate();
    } catch {
      abortSubmit('validation');
    }
    await saveSettingsMutation.mutateAsync({ body: values ?? {} });
    Toast.success('保存成功');
    setSettingsVisible(false);
  };

  const ruleModal = useEditModal<CheckinRule, CheckinRuleFormValues>({
    entityName: '签到规则',
    save: saveRuleMutation,
    defaults: { dayNumber: 1, points: 0, experience: 0, remark: '' },
  });

  const handleDelete = (record: CheckinRule) => {
    confirmDelete({
      title: `确认删除第 ${record.dayNumber} 天规则？`,
      content: '删除后该连续天数的奖励配置将失效。',
      onOk: async () => {
        await deleteRuleMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('删除成功');
      },
    });
  };

  const columns: ColumnProps<CheckinRule>[] = [
    { title: '连续天数', dataIndex: 'dayNumber', width: 100, align: 'right' },
    { title: '积分奖励', dataIndex: 'points', width: 100, align: 'right' },
    { title: '经验奖励', dataIndex: 'experience', width: 100, align: 'right' },
    { title: '备注', dataIndex: 'remark', render: renderEllipsis },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<CheckinRule>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('member:checkin:rule:update'),
          onClick: () => { ruleModal.openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('member:checkin:rule:delete'),
          onClick: () => handleDelete(record),
        },
      ],
    }),
  ];

  const renderRefreshButton = () => (
    <RefreshButton onClick={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.checkinRules })} />
  );

  const renderSettingsButton = () => hasPermission('member:checkin:setting:update') ? (
    <Button type="tertiary" icon={<Settings size={14} />} onClick={openSettings}>
      签到设置
    </Button>
  ) : null;

  const renderCreateButton = () => hasPermission('member:checkin:rule:create') ? (
    <CreateButton onClick={ruleModal.openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderRefreshButton()}
            {renderSettingsButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderRefreshButton()}
            {renderCreateButton()}
          </>
        )}
        mobileActions={renderSettingsButton()}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        size="small"
        pagination={false}
        empty="暂无签到规则"
      />

      <AppModal
        {...ruleModal.modalProps}
        width={520}
      >
        <Form
          key={ruleModal.formKey} {...ruleModal.formProps}
        >
          <Form.InputNumber field="dayNumber" label="天数" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入天数' }]} />
          <Form.InputNumber field="points" label="积分奖励" min={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入积分奖励' }]} />
          <Form.InputNumber field="experience" label="经验奖励" min={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入经验奖励' }]} />
          <Form.TextArea field="remark" label="备注" maxCount={256} placeholder="请输入备注" />
        </Form>
      </AppModal>

      <AppModal
        title="签到设置"
        visible={settingsVisible}
        width={480}
        closeOnEsc
        onCancel={() => setSettingsVisible(false)}
        onOk={handleSaveSettings}
      >
        <Form
          key={settings?.updatedAt ?? 'settings'}
          getFormApi={(api) => { settingsFormApi.current = api; }}
          initValues={settings ?? { makeupEnabled: false, makeupCostPoints: 20, makeupMaxDays: 7 }}
          labelPosition="left"
          labelWidth={140}
        >
          <Form.Switch field="makeupEnabled" label="允许会员自助补签" extraText="开启后会员可在前台对漏签日期自助补签；关闭时仅后台可代为补签" />
          <Form.InputNumber field="makeupCostPoints" label="补签消耗积分" min={0} style={{ width: '100%' }} extraText="会员每自助补签 1 天需消耗的积分，0 表示免费补签" rules={[{ required: true, message: '请输入补签消耗积分' }]} />
          <Form.InputNumber field="makeupMaxDays" label="可回溯天数" min={1} max={366} style={{ width: '100%' }} extraText="最多允许补签多少天前的漏签日期" rules={[{ required: true, message: '请输入可回溯天数' }]} />
        </Form>
      </AppModal>
    </div>
  );
}
