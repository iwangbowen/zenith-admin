/**
 * 新建导入弹窗：选实体 → 看字段说明 → 下载模板 / 预检 / 上传导入。
 * 需要页面上下文的实体（如 CMS 内容）引导到业务页面操作。
 */
import { useMemo, useState } from 'react';
import { Banner, Button, Descriptions, Modal, Radio, RadioGroup, Select, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { Download, FileSearch, Upload } from 'lucide-react';
import type { ImportEntityMeta } from '@zenith/shared/tasks';
import { downloadImportTemplate, useInspectImportJob } from '@/hooks/queries/import-jobs';
import { useImportUpload } from '@/hooks/useImportUpload';
import { groupImportEntitiesByModule } from './import-entity-groups';

const { Text } = Typography;

interface NewImportModalProps {
  visible: boolean;
  entities: ImportEntityMeta[];
  entitiesLoading: boolean;
  onClose: () => void;
  /** 任务提交成功：调用方关闭本弹窗并打开进度弹窗 */
  onSubmitted: (taskId: number, entityTitle: string) => void;
}

export default function NewImportModal({ visible, entities, entitiesLoading, onClose, onSubmitted }: Readonly<NewImportModalProps>) {
  const [selectedEntity, setSelectedEntity] = useState<string>('');
  const [prepared, setPrepared] = useState<{ fileId: string; dryRun: boolean; fileName: string; entity: string; context?: Record<string, unknown> } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<'error' | 'skip'>('error');

  const entity = entities.find((e) => e.entity === selectedEntity) ?? null;

  const inspect = useInspectImportJob();
  const { fileInput, pickFile, submitting, isDryRun, submitPrepared } = useImportUpload({
    resolveTarget: () => (entity ? { entity: entity.entity } : null),
    onSubmitted: (task) => { if (entity) onSubmitted(task.id, entity.title); },
    inspectBeforeSubmit: true,
    onPrepared: (value) => {
      setPrepared(value);
      void inspect.mutateAsync({ body: { entity: value.entity, fileId: value.fileId, ...(value.context ? { context: value.context } : {}) } }).then(result => {
        setMapping(Object.fromEntries(Object.entries(result.suggestedMapping).flatMap(([key, header]) => header ? [[key, header]] : [])));
      });
    },
  });

  const entityGroups = useMemo(() => groupImportEntitiesByModule(entities), [entities]);

  const retryInspection = () => {
    if (!prepared) return;
    void inspect.mutateAsync({ body: { entity: prepared.entity, fileId: prepared.fileId, ...(prepared.context ? { context: prepared.context } : {}) } }).then(result => {
      setMapping(Object.fromEntries(Object.entries(result.suggestedMapping).flatMap(([key, header]) => header ? [[key, header]] : [])));
    });
  };

  const requiredColumns = entity?.columns.filter((c) => c.required) ?? [];
  const missingRequiredMapping = Boolean(entity?.columns.some(column => column.required && !mapping[column.key]));

  return (
    <Modal
      title="新建导入"
      visible={visible}
      onCancel={onClose}
      closeOnEsc
      footer={null}
      width={560}
      afterClose={() => { setSelectedEntity(''); setPrepared(null); setMapping({}); inspect.reset(); }}
    >
      {fileInput}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 12 }}>
        <Spin spinning={entitiesLoading}>
          <Select
            placeholder="选择要导入的数据类型"
            value={selectedEntity || undefined}
            onChange={(value) => { setSelectedEntity((value as string) ?? ''); setPrepared(null); setMapping({}); inspect.reset(); }}
            style={{ width: '100%' }}
            filter
          >
            {entityGroups.map(([module, items]) => (
              <Select.OptGroup key={module} label={module}>
                {items.map((e) => <Select.Option key={e.entity} value={e.entity}>{e.title}</Select.Option>)}
              </Select.OptGroup>
            ))}
          </Select>
        </Spin>

        {entity && !prepared && (
          <>
            <Descriptions
              size="small"
              row
              data={[
                { key: '字段数', value: `${entity.columns.length} 个` },
                { key: '必填字段', value: requiredColumns.length > 0 ? requiredColumns.map((c) => c.header).join('、') : '无' },
                { key: '单次上限', value: `${entity.maxRows} 行` },
              ]}
            />
            {entity.description && <Text type="tertiary" size="small">{entity.description}</Text>}
            <div>
              <Tag color="light-blue" size="small">xlsx</Tag>{' '}
              <Tag color="light-blue" size="small">csv</Tag>{' '}
              <Text type="quaternary" size="small">按模板表头定位列，逐行校验并给出行级成败明细</Text>
            </div>

            {entity.requiresContext ? (
              <Banner
                fullMode={false} type="warning" closeIcon={null}
                description={`「${entity.title}」需要业务页面上下文（如站点/栏目），请到对应模块页面使用「导入」按钮操作。`}
              />
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  icon={<Download size={14} />}
                  onClick={() => void downloadImportTemplate(entity.entity, entity.title)}
                >
                  下载模板
                </Button>
                <Button
                  icon={<FileSearch size={14} />}
                  loading={submitting && isDryRun()}
                  onClick={() => pickFile(true)}
                >
                  预检文件
                </Button>
                <Button
                  type="primary"
                  theme="solid"
                  icon={<Upload size={14} />}
                  loading={submitting && !isDryRun()}
                  onClick={() => pickFile(false)}
                >
                  上传导入
                </Button>
              </div>
            )}
          </>
        )}
        {entity && prepared && (
          <>
            <Banner
              type={inspect.isError ? 'danger' : 'info'}
              closeIcon={null}
              description={inspect.isPending
                ? `正在读取「${prepared.fileName}」的表头和样例，请稍候…`
                : inspect.isError
                  ? `读取「${prepared.fileName}」失败：${inspect.error instanceof Error ? inspect.error.message : '接口暂不可用'}`
                  : inspect.data
                    ? `已读取「${prepared.fileName}」，共 ${inspect.data.rowCount} 行。请确认字段映射后再提交。`
                    : `等待读取「${prepared.fileName}」…`}
            />
            {inspect.isPending && <Spin tip="正在读取表头和样例" />}
            {inspect.isError && <Button onClick={retryInspection} loading={inspect.isPending}>重试读取</Button>}
            {inspect.data && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Text type="tertiary" size="small">样例（最多展示 5 行）：{inspect.data.sample.length ? JSON.stringify(inspect.data.sample) : '无有效数据行'}</Text>
              {entity.columns.map(column => <div key={column.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text strong style={{ width: 120 }}>{column.header}{column.required ? '*' : ''}</Text>
                <Select value={mapping[column.key] || undefined} placeholder="选择文件列（可留空）" style={{ flex: 1 }} onChange={value => setMapping(old => ({ ...old, [column.key]: String(value ?? '') }))}>
                  {inspect.data.headers.map(header => <Select.Option key={header} value={header}>{header}</Select.Option>)}
                </Select>
              </div>)}
              <Text strong>重复记录</Text>
              <RadioGroup value={duplicateMode} onChange={event => setDuplicateMode(event.target.value as 'error' | 'skip')}>
                <Radio value="error">报错并保留错误行</Radio><Radio value="skip">跳过重复行并继续</Radio>
              </RadioGroup>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => { setPrepared(null); inspect.reset(); }}>重新选择</Button>
                <Button type="primary" loading={submitting} disabled={!inspect.data || inspect.isPending || missingRequiredMapping} onClick={() => void submitPrepared(prepared, { fieldMapping: mapping, duplicateMode })}>{prepared.dryRun ? '提交预检' : '确认导入'}</Button>
              </div>
            </div>}
          </>
        )}
        {!entity && !entitiesLoading && (
          <Text type="tertiary" size="small">
            流程：下载模板 → 填写数据 → 上传提交。预检模式仅校验数据不落库，适合正式导入前试跑。
          </Text>
        )}
      </div>
    </Modal>
  );
}
