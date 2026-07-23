import type { CmsTheme } from '../types';
import {
  IndexTemplate, ListTemplate, DetailTemplate, PageTemplate, SearchTemplate, TagTemplate, NotFoundTemplate, CustomPageTemplate,
  ListCardTemplate, ListCompactTemplate, DetailPlainTemplate, InteractionTemplate,
} from './templates';

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
  interaction: InteractionTemplate,
  extraListTemplates: {
    'list-card': { label: '卡片网格（产品/案例）', component: ListCardTemplate },
    'list-compact': { label: '紧凑标题（公告/文件）', component: ListCompactTemplate },
  },
  extraDetailTemplates: {
    'detail-plain': { label: '简洁正文（公告/政策）', component: DetailPlainTemplate },
  },
  settingsSchema: [
    { name: 'contactPhone', label: '页头联系电话', fieldType: 'text', group: '页头', placeholder: '如 400-800-8888', description: '显示在页头搜索框左侧，留空不显示' },
    { name: 'bannerImage', label: '首页横幅图', fieldType: 'image', group: '首页', description: '显示在首页顶部（与 home-banner 碎片可并存，横幅在前）' },
    { name: 'bannerLink', label: '横幅跳转链接', fieldType: 'text', group: '首页', placeholder: 'https://... 留空不跳转' },
    { name: 'showHotSection', label: '显示热门排行', fieldType: 'switch', defaultValue: true, group: '首页' },
    { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚', placeholder: '如联系地址、邮箱等，支持多行' },
  ],
};
