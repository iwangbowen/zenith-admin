import { useState, useEffect, useCallback, useRef } from 'react';
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
  Popconfirm,
  Row,
  Col,
  Spin,
  Switch,
  Table,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Database, Plus, RotateCcw, Search } from 'lucide-react';
import type { DataMaskConfig, MaskType, Role, PaginatedResponse, SensitiveField } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';

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
  const [data, setData] = useState<DataMaskConfig[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<DataMaskConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);
  const [maskTypePreview, setMaskTypePreview] = useState<MaskType>('phone');
  const formRef = useRef<FormApi>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  // ─── 扫描状态 ─────────────────────────────────────────────────────────────────
  const [scanVisible, setScanVisible] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<SensitiveField[] | null>(null);
  const [scanSelected, setScanSelected] = useState<string[]>([]);
  const [scanEdits, setScanEdits] = useState<Record<string, { maskType: MaskType; label: string; entity: string }>>({});
  const [creatingBatch, setCreatingBatch] = useState(false);

  const handleToggleStatus = (record: DataMaskConfig, checked: boolean) => {
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        await request.put(`/api/data-mask-configs/${record.id}`, { enabled: checked });
        Toast.success(checked ? '已启用' : '已停用');
        void fetchData();
      } catch (err: unknown) {
        Toast.error((err as { message?: string })?.message || '操作失败');
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
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

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const params2 = params ?? searchParamsRef.current;
    const { keyword: kw } = params2;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(kw ? { keyword: kw } : {}),
        ...(params2.maskType ? { maskType: params2.maskType } : {}),
        ...(params2.enabled ? { enabled: params2.enabled } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<DataMaskConfig>>(`/api/data-mask-configs?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
        setPage(res.data.page);
      }
    } catch {
      Toast.error('加载脉敏规则失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    request.get<Role[]>('/api/roles/all').then((res) => {
      setRoleOptions((res.data ?? []).map((r) => ({ value: r.code, label: r.name })));
    }).catch(() => {});
  }, []);

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
    setModalDetailLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setMaskTypePreview('phone');
    setModalVisible(true);
  };

  const openEdit = async (row: DataMaskConfig) => {
    setEditing(row);
    setMaskTypePreview(row.maskType);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<DataMaskConfig>(`/api/data-mask-configs/${row.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditing(res.data);
      setMaskTypePreview(res.data.maskType);
    } else {
      Toast.error(res.message || '获取规则详情失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await request.delete(`/api/data-mask-configs/${id}`);
      Toast.success('删除成功');
      void fetchData();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      Toast.error(msg || '删除失败');
    }
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
      const res = await request.get<SensitiveField[]>('/api/data-mask-configs/scan');
      if (res.code === 0) {
        const results = res.data ?? [];
        setScanResults(results);
        setScanSelected(results.filter((r) => !r.hasRule).map((r) => `${r.tableName}:${r.columnName}`));
        setScanEdits({});
      } else {
        Toast.error(res.message || '扫描失败');
      }
    } catch (err: unknown) {
      Toast.error((err as { message?: string })?.message || '扫描失败');
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
      const res = await request.post<{ created: number; skipped: number }>('/api/data-mask-configs/batch-create', { items });
      if (res.code === 0) {
        const skippedMsg = res.data.skipped > 0 ? `，跳过 ${res.data.skipped} 条（已有规则）` : '';
        Toast.success(`已生成 ${res.data.created} 条规则${skippedMsg}`);
        closeScan();
        void fetchData();
      } else {
        Toast.error(res.message || '生成规则失败');
      }
    } catch (err: unknown) {
      Toast.error((err as { message?: string })?.message || '生成规则失败');
    } finally {
      setCreatingBatch(false);
    }
  };

  const handleSubmit = async () => {
    try {
      let values: FormValues;
      try { values = (await formRef.current?.validate())!; } catch { return; }
      setSubmitting(true);
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
      if (editing) {
        await request.put(`/api/data-mask-configs/${editing.id}`, body);
        Toast.success('更新成功');
      } else {
        await request.post('/api/data-mask-configs', body);
        Toast.success('创建成功');
      }
      closeModal();
      void fetchData();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      if (msg && !msg.includes('validate')) Toast.error(msg || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const getInitValues = (): Partial<FormValues> => {
    if (!editing) return { enabled: true, exemptRoleCodes: [], maskType: 'phone', prefixKeep: 3, suffixKeep: 4, maskChar: '*' };
    return {
      entity:          editing.entity,
      field:           editing.field,
      label:           editing.label,
      maskType:        editing.maskType,
      exemptRoleCodes: editing.exemptRoleCodes,
      enabled:         editing.enabled,
      remark:          editing.remark ?? undefined,
      prefixKeep:      editing.customRule?.prefixKeep ?? 3,
      suffixKeep:      editing.customRule?.suffixKeep ?? 4,
      maskChar:        editing.customRule?.maskChar ?? '*',
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
          loading={togglingIds.has(record.id)}
          disabled={!hasPermission('system:data-mask:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    {
      title: '操作', fixed: 'right' as const, width: 130,
      render: (_: unknown, record: DataMaskConfig) => (
        <Space>
          {hasPermission('system:data-mask:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          )}
          {hasPermission('system:data-mask:delete') && (
            <Popconfirm title="确定要删除该规则吗？" onConfirm={() => handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索实体 / 字段"
          value={searchParams.keyword}
          onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
          onEnterPress={() => { setPage(1); void fetchData(1, pageSize); }}
          showClear
          style={{ width: 200 }}
        />
        <Select
          placeholder="脉敏类型"
          value={searchParams.maskType || undefined}
          onChange={(v) => setSearchParams((prev) => ({ ...prev, maskType: typeof v === 'string' ? v : '' }))}
          showClear
          style={{ width: 160 }}
        >
          {MASK_TYPE_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{MASK_TYPE_LABELS[o.value]}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder="启用状态"
          value={searchParams.enabled || undefined}
          onChange={(v) => setSearchParams((prev) => ({ ...prev, enabled: typeof v === 'string' ? v : '' }))}
          showClear
          style={{ width: 120 }}
        >
          <Select.Option value="true">启用</Select.Option>
          <Select.Option value="false">停用</Select.Option>
        </Select>
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('system:data-mask:list') && (
          <Button icon={<Database size={14} />} onClick={openScan}>扫描敏感字段</Button>
        )}
        {hasPermission('system:data-mask:create') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        rowKey="id"
        pagination={buildPagination(total, fetchData)}
        scroll={{ x: 'max-content' }}
      />

      <AppModal
        title={editing ? '编辑脱敏规则' : '新增脱敏规则'}        visible={modalVisible}
        onCancel={closeModal}
        onOk={handleSubmit}
        okText={editing ? '保存' : '创建'}
        okButtonProps={{ loading: submitting, disabled: modalDetailLoading }}
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
      <Modal
        title="扫描数据库敏感字段"
        visible={scanVisible}
        onCancel={closeScan}
        width={980}
        footer={
          scanResults !== null && scanResults.length > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="secondary" size="small">
                共发现 {scanResults.length} 个字段，已勾选 {scanSelected.length} 个
              </Typography.Text>
              <Space>
                <Button onClick={closeScan}>取消</Button>
                <Button
                  type="primary"
                  loading={creatingBatch}
                  disabled={scanSelected.length === 0}
                  onClick={() => void handleBatchCreate()}
                >
                  生成规则（{scanSelected.length}）
                </Button>
              </Space>
            </div>
          ) : (
            <Button onClick={closeScan}>关闭</Button>
          )
        }
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
              scroll={{ y: 400, x: 'max-content' }}
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
                  width: 140,
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
      </Modal>
    </div>
  );
}
