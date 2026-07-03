import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Select,
  Tag,
  Space,
  Modal,
  Form,
  Toast,
  Typography,
  Row,
  Col,
  Spin,
  Switch,
  Table,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Database, Plus, RotateCcw, Search } from 'lucide-react';
import type { DataMaskConfig, MaskType, SensitiveField } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  dataMaskKeys,
  useBatchCreateDataMask,
  useDataMaskDetail,
  useDataMaskList,
  useDataMaskRoleOptions,
  useDeleteDataMask,
  useSaveDataMask,
  useScanDataMaskFields,
} from '@/hooks/queries/data-mask';

const { Text } = Typography;

const MASK_TYPE_LABELS: Record<MaskType, string> = {
  phone:     '手机号',
  email:     '邮箱',
  id_card:   '身份证',
  name:      '姓名',
  bank_card: '银行卡',
  custom:    '自定义',
};

const MASK_TYPE_PREVIEWS: Record<MaskType, string> = {
  phone:     '138****1234',
  email:     'adm***@example.com',
  id_card:   '110101********1234',
  name:      '张*丰',
  bank_card: '************7890',
  custom:    '—',
};

const MASK_TYPE_OPTIONS = Object.entries(MASK_TYPE_LABELS).map(([v, l]) => ({
  value: v as MaskType,
  label: `${l}（${MASK_TYPE_PREVIEWS[v as MaskType]}）`,
}));

type FormValues = {
  entity: string;
  field: string;
  label: string;
  maskType: MaskType;
  exemptRoleCodes: string[];
  enabled: boolean;
  remark?: string;
  prefixKeep?: number;
  suffixKeep?: number;
  maskChar?: string;
};

interface SearchParams {
  keyword: string;
  maskType: string;
  enabled: string;
}

const defaultSearchParams: SearchParams = { keyword: '', maskType: '', enabled: '' };

export default function DataMaskPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<DataMaskConfig | null>(null);
  const [maskTypePreview, setMaskTypePreview] = useState<MaskType>('phone');
  const formRef = useRef<FormApi>(null);

  // ─── 扫描状态 ─────────────────────────────────────────────────────────────────
  const [scanVisible, setScanVisible] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<SensitiveField[] | null>(null);
  const [scanSelected, setScanSelected] = useState<string[]>([]);
  const [scanEdits, setScanEdits] = useState<Record<string, { maskType: MaskType; label: string; entity: string }>>({});
  const [creatingBatch, setCreatingBatch] = useState(false);
  const listQuery = useDataMaskList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    maskType: submittedParams.maskType || undefined,
    enabled: submittedParams.enabled || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useDataMaskDetail(editing?.id, modalVisible);
  const editingDetail = editing ? (detailQuery.data ?? editing) : null;
  const modalDetailLoading = !!editing && detailQuery.isFetching;
  const roleOptions = useDataMaskRoleOptions().data ?? [];
  const saveMutation = useSaveDataMask();
  const toggleStatusMutation = useSaveDataMask();
  const deleteMutation = useDeleteDataMask();
  const scanMutation = useScanDataMaskFields();
  const batchCreateMutation = useBatchCreateDataMask();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleToggleStatus = (record: DataMaskConfig, checked: boolean) => {
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id: record.id, values: { enabled: checked } });
      Toast.success(checked ? '已启用' : '已停用');
    };
    if (checked) {
      void doToggle();
    } else {
      Modal.confirm({
        title: '确认停用',
        content: `停用后「${record.label}（${record.entity}.${record.field}）」的脱敏规则将不再生效，确认停用？`,
        onOk: () => void doToggle(),
      });
    }
  };

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: dataMaskKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: dataMaskKeys.lists });
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    setMaskTypePreview('phone');
    setModalVisible(true);
  };

  const openEdit = (row: DataMaskConfig) => {
    setEditing(row);
    setMaskTypePreview(row.maskType);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  // ─── 扫描处理 ──────────────────────────────────────────────────────────────────

  const openScan = () => {
    setScanVisible(true);
    setScanResults(null);
    setScanSelected([]);
    setScanEdits({});
  };

  const closeScan = () => {
    setScanVisible(false);
    setScanResults(null);
    setScanSelected([]);
    setScanEdits({});
  };

  const handleScan = async () => {
    setScanLoading(true);
    try {
      const results = await scanMutation.mutateAsync();
      setScanResults(results);
      setScanSelected(results.filter((r) => !r.hasRule).map((r) => `${r.tableName}:${r.columnName}`));
      setScanEdits({});
    } finally {
      setScanLoading(false);
    }
  };

  const getScanEdit = (record: SensitiveField) => {
    const key = `${record.tableName}:${record.columnName}`;
    return scanEdits[key] ?? { entity: record.tableName, label: record.suggestedLabel, maskType: record.suggestedMaskType };
  };

  const setScanEdit = (record: SensitiveField, patch: Partial<{ maskType: MaskType; label: string; entity: string }>) => {
    const key = `${record.tableName}:${record.columnName}`;
    setScanEdits((prev) => ({
      ...prev,
      [key]: { ...getScanEdit(record), ...patch },
    }));
  };

  const handleBatchCreate = async () => {
    if (scanSelected.length === 0) return;
    const items = scanSelected.map((key) => {
      const record = scanResults!.find((r) => `${r.tableName}:${r.columnName}` === key)!;
      const edit = scanEdits[key] ?? { entity: record.tableName, label: record.suggestedLabel, maskType: record.suggestedMaskType };
      return {
        entity:          edit.entity,
        field:           record.columnName,
        label:           edit.label,
        maskType:        edit.maskType,
        exemptRoleCodes: [] as string[],
        enabled:         true,
      };
    });
    setCreatingBatch(true);
    try {
      const res = await batchCreateMutation.mutateAsync(items);
      const skippedMsg = res.skipped > 0 ? `，跳过 ${res.skipped} 条（已有规则）` : '';
      Toast.success(`已生成 ${res.created} 条规则${skippedMsg}`);
      closeScan();
    } finally {
      setCreatingBatch(false);
    }
  };

  const handleSubmit = async () => {
    let values: FormValues;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    const body = {
      entity:          values.entity.trim(),
      field:           values.field.trim(),
      label:           values.label.trim(),
      maskType:        values.maskType,
      exemptRoleCodes: values.exemptRoleCodes ?? [],
      enabled:         values.enabled,
      remark:          values.remark?.trim() || undefined,
      customRule: values.maskType === 'custom'
        ? { prefixKeep: values.prefixKeep ?? 3, suffixKeep: values.suffixKeep ?? 4, maskChar: values.maskChar || '*' }
        : undefined,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: body });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  };

  const getInitValues = (): Partial<FormValues> => {
    if (!editingDetail) return { enabled: true, exemptRoleCodes: [], maskType: 'phone', prefixKeep: 3, suffixKeep: 4, maskChar: '*' };
    return {
      entity:          editingDetail.entity,
      field:           editingDetail.field,
      label:           editingDetail.label,
      maskType:        editingDetail.maskType,
      exemptRoleCodes: editingDetail.exemptRoleCodes,
      enabled:         editingDetail.enabled,
      remark:          editingDetail.remark ?? undefined,
      prefixKeep:      editingDetail.customRule?.prefixKeep ?? 3,
      suffixKeep:      editingDetail.customRule?.suffixKeep ?? 4,
      maskChar:        editingDetail.customRule?.maskChar ?? '*',
    };
  };

  const columns: ColumnProps<DataMaskConfig>[] = [
    { title: '实体', dataIndex: 'entity', width: 100 },
    { title: '字段名', dataIndex: 'field', width: 110 },
    { title: '字段标签', dataIndex: 'label', width: 100 },
    {
      title: '脱敏类型', dataIndex: 'maskType', width: 200,
      render: (v: MaskType) => (
        <Space>
          <Text>{MASK_TYPE_LABELS[v]}</Text>
          <Text type="quaternary" size="small">{MASK_TYPE_PREVIEWS[v]}</Text>
        </Space>
      ),
    },
    {
      title: '豁免角色', dataIndex: 'exemptRoleCodes', width: 160,
      render: (codes: string[]) => codes.length === 0
        ? <Text type="quaternary">—</Text>
        : <Space wrap>{codes.map((c) => <Tag key={c} size="small" color="blue">{roleOptions.find((r) => r.value === c)?.label ?? c}</Tag>)}</Space>,
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
    {
      title: '启用状态', dataIndex: 'enabled', width: 90, fixed: 'right' as const,
      render: (v: boolean, record: DataMaskConfig) => (
        <Switch
          checked={v}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:data-mask:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<DataMaskConfig>({
      width: 130,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:data-mask:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:data-mask:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该规则吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索实体 / 字段"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="脱敏类型"
              value={draftParams.maskType || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, maskType: typeof v === 'string' ? v : '' }))}
              showClear
              style={{ width: 160 }}
            >
              {MASK_TYPE_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>{MASK_TYPE_LABELS[o.value]}</Select.Option>
              ))}
            </Select>
            <Select
              placeholder="启用状态"
              value={draftParams.enabled || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, enabled: typeof v === 'string' ? v : '' }))}
              showClear
              style={{ width: 120 }}
            >
              <Select.Option value="true">启用</Select.Option>
              <Select.Option value="false">停用</Select.Option>
            </Select>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            {hasPermission('system:data-mask:list') && (
              <Button icon={<Database size={14} />} onClick={openScan}>扫描敏感字段</Button>
            )}
            {hasPermission('system:data-mask:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索实体 / 字段"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('system:data-mask:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Select
              placeholder="脱敏类型"
              value={draftParams.maskType || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, maskType: typeof v === 'string' ? v : '' }))}
              showClear
              style={{ width: 160 }}
            >
              {MASK_TYPE_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>{MASK_TYPE_LABELS[o.value]}</Select.Option>
              ))}
            </Select>
            <Select
              placeholder="启用状态"
              value={draftParams.enabled || undefined}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, enabled: typeof v === 'string' ? v : '' }))}
              showClear
              style={{ width: 120 }}
            >
              <Select.Option value="true">启用</Select.Option>
              <Select.Option value="false">停用</Select.Option>
            </Select>
          </>
        )}
        mobileActions={hasPermission('system:data-mask:list') ? (
          <Button icon={<Database size={14} />} onClick={openScan}>扫描敏感字段</Button>
        ) : null}
        filterTitle="数据脱敏筛选"
        actionTitle="数据脱敏操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 'max-content' }}
      />

      <AppModal
        title={editing ? '编辑脱敏规则' : '新增脱敏规则'}        visible={modalVisible}
        onCancel={closeModal}
        onOk={handleSubmit}
        okText={editing ? '保存' : '创建'}
        okButtonProps={{ loading: saveMutation.isPending, disabled: modalDetailLoading }}
        width={660}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form<FormValues>
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { formRef.current = api; }}
          initValues={getInitValues() as FormValues}
          labelPosition="left"
          labelWidth={90}
          onValueChange={(vals) => {
            if (vals.maskType) setMaskTypePreview(vals.maskType as unknown as MaskType);
          }}
        >
          {/* 第一行：实体 + 字段名 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="entity" label="实体" placeholder="如 user" rules={[{ required: true, message: '请填写实体名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="field" label="字段名" placeholder="如 phone" rules={[{ required: true, message: '请填写字段名' }]} />
            </Col>
          </Row>

          {/* 第二行：字段标签 + 脱敏类型 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="label" label="字段标签" placeholder="如 手机号" rules={[{ required: true, message: '请填写字段标签' }]} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="maskType"
                label="脱敏类型"
                style={{ width: '100%' }}
                rules={[{ required: true }]}
                optionList={MASK_TYPE_OPTIONS}
              />
            </Col>
          </Row>

          {/* 效果预览 — 整行 */}
          <Row>
            <Col span={24}>
              <Form.Slot label="效果预览">
                <Tag color="orange" size="large" style={{ fontFamily: 'monospace' }}>
                  {MASK_TYPE_PREVIEWS[maskTypePreview]}
                </Tag>
              </Form.Slot>
            </Col>
          </Row>

          {/* 自定义规则 — 仅 custom 时显示 */}
          {maskTypePreview === 'custom' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="prefixKeep" label="保留前N位" min={0} max={20} style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="suffixKeep" label="保留后N位" min={0} max={20} style={{ width: '100%' }} />
              </Col>
            </Row>
          )}
          {maskTypePreview === 'custom' && (
            <Row>
              <Col span={12}>
                <Form.Input field="maskChar" label="掩码字符" maxLength={1} placeholder="默认 *" />
              </Col>
            </Row>
          )}

          {/* 豁免角色 + 启用 — 同一行，各占一半 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="exemptRoleCodes"
                label="豁免角色"
                multiple
                style={{ width: '100%' }}
                optionList={roleOptions}
                placeholder="拥有此角色的用户将看到原始数据"
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="enabled"
                label="是否启用"
                style={{ width: '100%' }}
                optionList={[
                  { value: true, label: '启用' },
                  { value: false, label: '禁用' },
                ] as unknown as Array<{ value: string | number; label: string }>}
              />
            </Col>
          </Row>

          {/* 备注 — 单独整行 */}
          <Row>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" maxCount={256} rows={1} />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>

      {/* ─── 扫描敏感字段对话框 ───────────────────────────────────────────────── */}
      <AppModal
        title="扫描数据库敏感字段"
        visible={scanVisible}
        onCancel={closeScan}
        onOk={() => void handleBatchCreate()}
        okText={scanSelected.length > 0 ? `生成规则（${scanSelected.length}）` : '生成规则'}
        okButtonProps={{ loading: creatingBatch, disabled: !scanResults || scanResults.length === 0 || scanSelected.length === 0 }}
        cancelText="关闭"
        width={980}
      >
        {scanResults === null ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
              自动识别数据库表中字段名含 <Typography.Text code>phone</Typography.Text>、<Typography.Text code>email</Typography.Text>、<Typography.Text code>id_card</Typography.Text>、<Typography.Text code>bank</Typography.Text> 等关键字的列，并给出脱敏建议。
            </Typography.Text>
            <Button type="primary" icon={<Database size={14} />} loading={scanLoading} onClick={() => void handleScan()}>
              开始扫描
            </Button>
          </div>
        ) : null}
        {scanResults !== null && scanResults.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Typography.Text type="secondary">未发现敏感字段，或所有敏感字段已配置规则。</Typography.Text>
            <div style={{ marginTop: 16 }}>
              <Button size="small" type="tertiary" loading={scanLoading} onClick={() => void handleScan()}>重新扫描</Button>
            </div>
          </div>
        )}
        {scanResults !== null && scanResults.length > 0 && (
          <>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button size="small" type="tertiary" loading={scanLoading} onClick={() => void handleScan()}>重新扫描</Button>
              <Typography.Text size="small" type="secondary">可编辑实体名、字段标签、脱敏类型后批量生成规则</Typography.Text>
            </div>
            <Table
              size="small"
              bordered
              rowKey={(r: SensitiveField | undefined) => r ? `${r.tableName}:${r.columnName}` : ''}
              rowSelection={{
                selectedRowKeys: scanSelected,
                onChange: (keys) => setScanSelected(keys as string[]),
              }}
              dataSource={scanResults}
              pagination={false}
              scroll={{ y: 400, x: 1050 }}
              columns={[
                {
                  title: '表名', dataIndex: 'tableName', width: 160,
                  render: (v: string) => <Typography.Text code size="small">{v}</Typography.Text>,
                },
                {
                  title: '字段名', dataIndex: 'columnName', width: 140,
                  render: (v: string) => <Typography.Text code size="small">{v}</Typography.Text>,
                },
                {
                  title: '数据类型', dataIndex: 'dataType', width: 160,
                  render: (v: string) => <Typography.Text type="quaternary" size="small">{v}</Typography.Text>,
                },
                {
                  title: <span>实体名 <Typography.Text type="quaternary" size="small">（可编辑）</Typography.Text></span>,
                  dataIndex: 'tableName',
                  width: 150,
                  render: (_: unknown, record: SensitiveField) => (
                    <Input
                      size="small"
                      value={getScanEdit(record).entity}
                      onChange={(v) => setScanEdit(record, { entity: v })}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: <span>字段标签 <Typography.Text type="quaternary" size="small">（可编辑）</Typography.Text></span>,
                  dataIndex: 'suggestedLabel',
                  width: 160,
                  render: (_: unknown, record: SensitiveField) => (
                    <Input
                      size="small"
                      value={getScanEdit(record).label}
                      onChange={(v) => setScanEdit(record, { label: v })}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: '脱敏类型',
                  dataIndex: 'suggestedMaskType',
                  width: 150,
                  render: (_: unknown, record: SensitiveField) => (
                    <Select
                      size="small"
                      value={getScanEdit(record).maskType}
                      style={{ width: '100%' }}
                      onChange={(v) => setScanEdit(record, { maskType: v as MaskType })}
                      optionList={MASK_TYPE_OPTIONS}
                    />
                  ),
                },
                {
                  title: '状态', dataIndex: 'hasRule', width: 90, fixed: 'right' as const,
                  render: (v: boolean) => v
                    ? <Tag color="orange" size="small">已有规则</Tag>
                    : <Tag color="green" size="small">新规则</Tag>,
                },
              ]}
            />
          </>
        )}
      </AppModal>

    </div>
  );
}
