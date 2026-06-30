import { useMemo, useRef, useState } from 'react';
import {
  Banner, Button, Select, Space, Table, Toast, Typography, Upload,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Upload as UploadIcon, FileText } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { parseCsv, parseJsonRows } from './csv-parse';

const { Text } = Typography;

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
}

interface Props {
  open: boolean;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onSuccess: () => void;
}

const SKIP = '__skip__';

/** 将字符串单元格按目标列类型做轻量转换 */
function coerce(value: unknown, dataType: string): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return null;
  const t = dataType.toLowerCase();
  if (/int|numeric|decimal|real|double|serial/.test(t)) {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (t === 'boolean') {
    if (/^(true|t|1|yes|y)$/i.test(s)) return true;
    if (/^(false|f|0|no|n)$/i.test(s)) return false;
    return s;
  }
  if (/jsonb?$/.test(t)) {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}

export function ImportModal(props: Readonly<Props>) {
  const { open, schema, table, columns, onClose, onSuccess } = props;
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);

  const reset = () => {
    setFileName(''); setHeaders([]); setRawRows([]); setMapping({}); setParseError(null);
    resetRef.current?.();
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        const isJson = file.name.toLowerCase().endsWith('.json');
        const parsed = isJson ? parseJsonRows(text) : parseCsv(text);
        if (parsed.rows.length === 0) { setParseError('文件中没有可导入的数据行'); return; }
        setHeaders(parsed.headers);
        setRawRows(parsed.rows);
        setFileName(file.name);
        setParseError(null);
        // 自动按同名映射文件列 -> 表列
        const colNames = new Set(columns.map((c) => c.name));
        const auto: Record<string, string> = {};
        for (const h of parsed.headers) auto[h] = colNames.has(h) ? h : SKIP;
        setMapping(auto);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : '解析失败');
      }
    };
    reader.readAsText(file);
  };

  const mappedCount = useMemo(() => Object.values(mapping).filter((v) => v !== SKIP).length, [mapping]);

  const previewColumns: ColumnProps<Record<string, unknown>>[] = headers.map((h) => ({
    title: (
      <Space vertical spacing={2} align="start">
        <Text size="small" type="tertiary">{h}</Text>
        <Select
          size="small"
          value={mapping[h] ?? SKIP}
          onChange={(v) => setMapping((m) => ({ ...m, [h]: v as string }))}
          style={{ width: 130 }}
          optionList={[
            { label: '— 不导入 —', value: SKIP },
            ...columns.map((c) => ({ label: `${c.name}${c.isPrimaryKey ? ' (PK)' : ''}`, value: c.name })),
          ]}
        />
      </Space>
    ),
    dataIndex: h,
    width: 150,
    render: (v: unknown) => {
      if (v == null) return <Text type="quaternary">NULL</Text>;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{s}</Text>;
    },
  }));

  const handleImport = async () => {
    const colTypeMap = new Map(columns.map((c) => [c.name, c.dataType]));
    const activeMap = Object.entries(mapping).filter(([, target]) => target !== SKIP);
    if (activeMap.length === 0) { Toast.warning('请至少映射一列'); return; }

    const payloadRows = rawRows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [src, target] of activeMap) {
        out[target] = coerce(r[src], colTypeMap.get(target) ?? 'text');
      }
      return out;
    });

    setImporting(true);
    const res = await request.post<{ inserted: number }>(
      `/api/db-admin/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/import`,
      { rows: payloadRows },
      { silent: true },
    );
    setImporting(false);
    if (res.code === 0 && res.data) {
      Toast.success(`成功导入 ${res.data.inserted} 行`);
      reset();
      onSuccess();
    } else {
      Toast.error(res.message ?? '导入失败');
    }
  };

  return (
    <AppModal
      title={`导入数据 · ${schema}.${table}`}
      visible={open}
      onCancel={() => { reset(); onClose(); }}
      onOk={() => void handleImport()}
      okText={rawRows.length > 0 ? `导入 ${rawRows.length} 行` : '导入'}
      cancelText="取消"
      okButtonProps={{ loading: importing, disabled: mappedCount === 0 || rawRows.length === 0 }}
      width={860}
    >
      <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
        <Upload
          accept=".csv,.json"
          limit={1}
          draggable
          action=""
          uploadTrigger="custom"
          beforeUpload={({ file }) => {
            if (file.fileInstance) handleFile(file.fileInstance);
            return false;
          }}
          onRemove={() => reset()}
          style={{ width: '100%' }}
        >
          <div style={{ padding: '20px 16px', textAlign: 'center', border: '1px dashed var(--semi-color-border)', borderRadius: 6, width: '100%' }}>
            <UploadIcon size={24} style={{ color: 'var(--semi-color-text-2)' }} />
            <div style={{ marginTop: 6 }}><Text>点击或拖拽上传 CSV / JSON 文件</Text></div>
            <Text type="tertiary" size="small">CSV 首行须为列名；JSON 须为对象数组</Text>
          </div>
        </Upload>

        {parseError && <Banner type="danger" fullMode={false} closeIcon={null} description={parseError} style={{ width: '100%' }} />}

        {fileName && rawRows.length > 0 && (
          <>
            <Space>
              <FileText size={14} />
              <Text strong>{fileName}</Text>
              <Text type="tertiary" size="small">{rawRows.length} 行 · 已映射 {mappedCount} / {headers.length} 列</Text>
            </Space>
            <Banner
              type="info" fullMode={false} closeIcon={null} style={{ width: '100%' }}
              description="为每个文件列选择对应的表字段（不导入的列选「不导入」）。导入将在单个事务中执行，任一行失败则整体回滚。"
            />
            <div style={{ width: '100%', overflow: 'auto' }}>
              <Table
                columns={previewColumns}
                dataSource={rawRows.slice(0, 8).map((r, i) => ({ ...r, __k: i }))}
                rowKey="__k"
                size="small"
                pagination={false}
                bordered
                scroll={{ x: 'max-content' }}
              />
            </div>
            {rawRows.length > 8 && <Text type="tertiary" size="small">仅预览前 8 行</Text>}
          </>
        )}
      </Space>
    </AppModal>
  );
}

ImportModal.displayName = 'ImportModal';
