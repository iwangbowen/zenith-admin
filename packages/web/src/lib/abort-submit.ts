/**
 * 提交中断标记。
 *
 * ## 为什么需要它
 * 弹窗提交必须靠 **抛出** 来中断：Semi 的 Modal 用 `onOk` 返回的 Promise 状态驱动确定按钮的
 * loading，`return` 会让弹窗停在原地且按钮一直转圈（详见 `useEditModal` 文件头契约 1）。
 *
 * 但「中断」和「出错」在 Promise 上是同一种信号。`useGlobalErrorHandler` 因此需要区分两者，
 * 此前靠的是**消息形状**：`/^\w+$/` 的单词消息视为控制流标记、放行，其余一律当真错误处理
 * ——弹「操作失败：xxx」Toast 并上报错误监控。
 *
 * 这条规则不写在类型里、不写在调用点旁边，只写在兜底 hook 的注释里，于是必然被漏掉：
 * `throw new Error('empty content')`（带空格）、`throw new Error('save-failed')`（带连字符）
 * 都会穿透兜底，用户在自己的中文校验提示之外**再吃一个英文的「操作失败：empty content」**，
 * 同时给错误监控灌进一条由用户正常操作产生的假告警。
 *
 * `abortSubmit()` 把这个判断从「猜消息长什么样」变成「看类型是什么」，调用点也自我说明。
 *
 * @example
 * ```ts
 * beforeSave: (values) => {
 *   if (!contentHtml) {
 *     Toast.warning('请输入公告内容');  // 面向用户的提示由调用方负责
 *     abortSubmit();                    // 中断提交，不弹兜底 Toast、不上报
 *   }
 *   return { ...values, content: contentHtml };
 * }
 * ```
 */
export class SubmitAborted extends Error {
  constructor(reason = 'validation') {
    super(reason);
    this.name = 'SubmitAborted';
  }
}

/**
 * 中断当前提交流程。
 *
 * 调用前请确保**已经给出面向用户的提示**（表单内联错误或 Toast）——本函数刻意不弹提示，
 * 以免与调用方自己的文案叠成两个。
 *
 * @param reason 仅用于调试，不会展示给用户
 */
export function abortSubmit(reason?: string): never {
  throw new SubmitAborted(reason);
}
