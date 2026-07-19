import type { CmsTheme } from '../types';
import { IndexTemplate, ListTemplate, DetailTemplate, PageTemplate, SearchTemplate, TagTemplate, NotFoundTemplate, CustomPageTemplate } from './templates';

/** 默认主题：企业官网/资讯门户风格，移动端自适应，静态页零外部资源依赖 */
export const defaultTheme: CmsTheme = {
  code: 'default',
  label: '默认主题',
  templates: {
    index: IndexTemplate,
    list: ListTemplate,
    detail: DetailTemplate,
    page: PageTemplate,
    search: SearchTemplate,
    tag: TagTemplate,
    notFound: NotFoundTemplate,
  },
  customPage: CustomPageTemplate,
};
