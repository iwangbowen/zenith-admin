import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import WorkflowFormRenderer from './WorkflowFormRenderer';

const fields: WorkflowFormField[] = [
  { key: 'amount', type: 'amount', label: '金额', defaultValue: 0 },
  { key: 'total', type: 'formula', label: '计算金额', formula: '{amount} * 2', defaultValue: 100 },
  { key: 'urgent', type: 'switch', label: '紧急', defaultValue: false },
];

describe('rendered derived values', () => {
  it('preserves transferred input over field defaults and calculates formulas at mount', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer fields={fields} initValues={{ amount: 80, total: 0, urgent: true }} getFormApi={(value) => { api = value; }} />);
    await waitFor(() => expect(api?.getValues()).toMatchObject({ amount: 80, total: 160, urgent: true }));
  });

  it('displays saved formula values without replacing them with defaults or a new calculation', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer fields={fields} readOnly initValues={{ amount: 80, total: 123, urgent: true }} getFormApi={(value) => { api = value; }} />);
    await waitFor(() => expect(api?.getValues()).toMatchObject({ amount: 80, total: 123, urgent: true }));
  });
});
