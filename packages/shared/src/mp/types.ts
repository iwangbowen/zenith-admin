/** 微信自定义菜单按钮（可嵌套二级 sub_button）；自引用结构，类型手写供递归 schema 标注 */
export interface MpMenuButton {
  name: string;
  type?: string;
  key?: string;
  url?: string;
  appid?: string;
  pagepath?: string;
  media_id?: string;
  article_id?: string;
  sub_button?: MpMenuButton[];
}
