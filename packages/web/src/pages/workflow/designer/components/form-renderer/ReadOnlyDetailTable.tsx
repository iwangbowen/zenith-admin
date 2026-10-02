import { useContext } from 'react';
import { Button, Form } from '@douyinfe/semi-ui';
import { Copy } from 'lucide-react';
import { isPlainObject } from '@zenith/shared/core';
import { isWorkflowFieldVisible, type WorkflowFormField } from '@zenith/shared/workflow';
import { copyTextWithToast } from '@/utils/clipboard';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { ValuesContext } from './contexts';
import { formatReadOnlyValue, readOnlyFieldLabel } from './read-only-text';
import './read-only-detail.css';

export function ReadOnlyDetailTable({ field }: Readonly<{ field: WorkflowFormField }>) {
  const values = useContext(ValuesContext);
  const columns = field.children ?? [];
  const rawRows = values[field.key];
  const rows = Array.isArray(rawRows)
    ? rawRows.filter((row): row is Record<string, unknown> => isPlainObject(row))
    : [];
  const cellText = (column: WorkflowFormField, row: Record<string, unknown>) => isWorkflowFieldVisible(column, row)
    ? formatReadOnlyValue(column, row[column.key]) || EMPTY_PLACEHOLDER
    : EMPTY_PLACEHOLDER;
  const hasSummary = columns.some((column) => column.detailSummary && (column.type === 'number' || column.type === 'amount'));
  const summaryText = (column: WorkflowFormField) => {
    if (!column.detailSummary || (column.type !== 'number' && column.type !== 'amount')) return '';
    const total = rows.reduce((sum, row) => {
      if (!isWorkflowFieldVisible(column, row)) return sum;
      const value = Number(row[column.key]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return formatReadOnlyValue(column, total);
  };
  const copyRows = () => {
    const clean = (text: string) => text.replace(/[\t\r\n]+/g, ' ');
    const lines = [columns.map((column) => clean(readOnlyFieldLabel(column))).join('\t')];
    rows.forEach((row) => lines.push(columns.map((column) => clean(cellText(column, row))).join('\t')));
    if (hasSummary && rows.length) lines.push(columns.map(summaryText).join('\t'));
    void copyTextWithToast(lines.join('\n'), { success: '明细已复制' });
  };

  return (
    <Form.Slot label={{ text: field.label }}>
      <div className="wf-readonly-detail-toolbar">
        <Button size="small" theme="borderless" icon={<Copy size={14} />} disabled={!rows.length} onClick={copyRows}>
          复制明细
        </Button>
      </div>
      <div className="wf-readonly-detail-scroll" tabIndex={0} role="region" aria-label={`${field.label}，可横向滚动`}>
        <table className="wf-readonly-detail-table" aria-label={field.label}>
          <thead>
            <tr>
              <th scope="col" className="wf-readonly-detail-index">#</th>
              {columns.map((column) => <th scope="col" key={column.key} style={{ minWidth: column.detailColumnWidth ?? 140 }}>{readOnlyFieldLabel(column)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={index}>
                <td className="wf-readonly-detail-index">{index + 1}</td>
                {columns.map((column) => <td key={column.key}>{cellText(column, row)}</td>)}
              </tr>
            )) : <tr><td colSpan={columns.length + 1} className="wf-readonly-detail-empty">暂无明细</td></tr>}
          </tbody>
          {hasSummary && rows.length > 0 && <tfoot><tr><th scope="row">合计</th>{columns.map((column) => <td key={column.key}>{summaryText(column)}</td>)}</tr></tfoot>}
        </table>
      </div>
    </Form.Slot>
  );
}
