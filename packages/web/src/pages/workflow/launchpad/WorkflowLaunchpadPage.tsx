import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Input, List, Space, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, RotateCcw, Search, Send } from 'lucide-react';
import type { WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from '@/components/workflow/WorkflowLaunchForm';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';

const UNCATEGORIZED = -1;

export default function WorkflowLaunchpadPage() {
  const navigate = useNavigate();
  const { categories } = useWorkflowCategories();
  const [loading, setLoading] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [keyword, setKeyword] = useState('');
  const [activeKeyword, setActiveKeyword] = useState('');

  const launchFormRef = useRef<WorkflowLaunchFormHandle>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowDefinition[]>('/api/workflows/definitions/published');
      if (res.code === 0) setDefinitions(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const categoryName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const grouped = useMemo(() => {
    const kw = activeKeyword.trim().toLowerCase();
    const filtered = kw
      ? definitions.filter((d) => d.name.toLowerCase().includes(kw) || (d.description ?? '').toLowerCase().includes(kw))
      : definitions;
    const groups = new Map<number, WorkflowDefinition[]>();
    for (const d of filtered) {
      const cid = d.categoryId ?? UNCATEGORIZED;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push(d);
    }
    return Array.from(groups.entries()).map(([cid, defs]) => ({
      categoryId: cid,
      categoryName: cid === UNCATEGORIZED ? '未分类' : (categoryName.get(cid) ?? '未分类'),
      defs,
    }));
  }, [definitions, activeKeyword, categoryName]);

  const openApply = (def: WorkflowDefinition) => {
    if (def.formType === 'external') {
      Toast.warning('业务系统主导流程请从对应业务模块发起');
      return;
    }
    setSelectedDef(def);
    setApplyVisible(true);
  };

  const closeApply = () => {
    setApplyVisible(false);
    setSelectedDef(null);
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!selectedDef) return;
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: !asDraft });
    if (!result) return;
    const { values, formData } = result;
    const setBusy = asDraft ? setSavingDraft : setSubmitting;
    setBusy(true);
    try {
      const res = await request.post('/api/workflows/instances', {
        definitionId: selectedDef.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
        ...(asDraft ? { asDraft: true } : {}),
      });
      if (res.code === 0) {
        Toast.success(asDraft ? '草稿已保存' : '申请已提交');
        closeApply();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = () => setActiveKeyword(keyword);
  const handleReset = () => { setKeyword(''); setActiveKeyword(''); };

  const renderDefinitionCard = (def: WorkflowDefinition) => (
    <button
      type="button"
      onClick={() => openApply(def)}
      style={{
        display: 'block', width: '100%', padding: 0, border: 'none',
        background: 'transparent', textAlign: 'left', cursor: 'pointer',
        font: 'inherit', color: 'inherit',
      }}
    >
      <Card shadows="hover" bodyStyle={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: def.categoryColor ?? 'var(--semi-color-primary)',
              color: '#fff',
            }}
          >
            <Send size={20} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{def.name}</Typography.Text>
            <Typography.Paragraph
              type="tertiary"
              size="small"
              ellipsis={{ rows: 2, showTooltip: true }}
              style={{ marginTop: 4, marginBottom: 0, minHeight: 36, lineHeight: '18px' }}
            >
              {def.description || '点击发起该流程'}
            </Typography.Paragraph>
          </div>
        </div>
      </Card>
    </button>
  );

  const renderContent = () => {
    if (loading) {
      return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
    }
    if (grouped.length === 0) {
      return <Empty title="暂无可发起的流程" description="请联系管理员发布流程定义" style={{ padding: 60 }} />;
    }
    return (
      <div style={{ padding: '4px 0 16px' }}>
        {grouped.map((group) => (
          <div key={group.categoryId} style={{ marginBottom: 24 }}>
            <Typography.Title heading={6} style={{ margin: '8px 0 12px' }}>{group.categoryName}</Typography.Title>
            <List
              grid={{ gutter: 12, xs: 24, sm: 12, md: 8, lg: 6, xl: 6, xxl: 4 }}
              dataSource={group.defs}
              split={false}
              renderItem={(def) => (
                <List.Item style={{ padding: '0 0 12px', display: 'block' }}>
                  {renderDefinitionCard(def)}
                </List.Item>
              )}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索流程名称 / 说明"
      value={keyword}
      onChange={setKeyword}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 240 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileActions={renderResetButton()}
      />

      {renderContent()}

      <WorkflowSideSheet
        title={selectedDef ? `发起：${selectedDef.name}` : '发起申请'}
        visible={applyVisible}
        onCancel={closeApply}
        variant="split"
        footerLeft={
          <Button
            theme="borderless"
            icon={<ExternalLink size={14} />}
            onClick={() => {
              if (!selectedDef) return;
              const icon = selectedDef.customForm?.icon ?? selectedDef.categoryIcon ?? 'Send';
              navigate(`/workflow/launch/${selectedDef.id}`, { state: { tabTitle: `发起：${selectedDef.name}`, tabIcon: icon } });
            }}
          >
            在新页签打开
          </Button>
        }
        footerRight={
          <Space>
            <Button onClick={closeApply}>取消</Button>
            <Button loading={savingDraft} disabled={submitting} onClick={() => void handleSubmit(true)}>保存草稿</Button>
            <Button type="primary" loading={submitting} disabled={savingDraft} onClick={() => void handleSubmit(false)}>提交</Button>
          </Space>
        }
      >
        {selectedDef && <WorkflowLaunchForm ref={launchFormRef} def={selectedDef} container="sheet" />}
      </WorkflowSideSheet>
    </div>
  );
}
