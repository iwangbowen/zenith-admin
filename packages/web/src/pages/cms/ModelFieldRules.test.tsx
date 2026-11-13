import { render, waitFor } from '@testing-library/react';
import { Form } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { describe, expect, it, vi } from 'vitest';
import { CmsFieldDefinitionsEditor } from './ModelFieldRules';
vi.mock('@/hooks/queries/cms-models', () => ({ useAllCmsModels: () => ({ data: [] }) }));
vi.mock('@/hooks/queries/cms-components', () => ({ useAllCmsComponents: () => ({ data: [] }), useCmsComponentVersions: () => ({ data: [] }) }));
vi.mock('@/hooks/queries/dicts', () => ({ useDictList: () => ({ data: { list: [] } }) }));
vi.mock('@/hooks/useDictItems', () => ({ useDictItems: () => ({ items: [] }) }));
describe('model field editor initial values', () => {
  it('keeps existing field types and numeric defaults when mounting the editor', async () => {
    let api: FormApi | undefined;
    render(<Form initValues={{ fields: [
      { id: 'description', name: 'bio', label: '简介', fieldType: 'textarea' },
      { id: 'score', name: 'score', label: '分数', fieldType: 'number', defaultValue: 2, configuration: { min: 1, max: 10 } },
    ] }} getFormApi={value => { api = value; }}><CmsFieldDefinitionsEditor field="fields" siteId={1} /></Form>);
    await waitFor(() => expect(api?.getValue('fields')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'description', fieldType: 'textarea' }),
      expect.objectContaining({ id: 'score', fieldType: 'number', defaultValue: 2, configuration: expect.objectContaining({ min: 1, max: 10 }) }),
    ])));
  });
});
