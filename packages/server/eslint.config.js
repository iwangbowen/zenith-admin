import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**', 'node_modules/**', 'logs/**', 'storage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // @zenith/shared 已按业务域拆分：根入口会把全部 18 个域拉进依赖图，
      // 使「改 CMS 类型」这类局部改动波及所有消费方，故禁止直接引用根入口与已废弃的旧巨石路径。
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@zenith/shared',
              message:
                "请改用域子路径：'@zenith/shared/identity' | 'payment' | 'workflow' | 'cms' | 'report' | 'core' 等；种子数据用 '@zenith/shared/seed'。",
            },
            {
              name: '@zenith/shared/types',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/validation',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/constants',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/<domain>'。",
            },
            {
              name: '@zenith/shared/seed-data',
              message: "旧巨石路径已删除，请改用 '@zenith/shared/seed'。",
            },
          ],
        },
      ],
    },
  },
  // 部分更新 schema 一律由 partialForUpdate()（@zenith/shared/core）派生：Zod 的 .partial()
  // 保留 .default()，字段省略时会填入默认值并经服务层 .set({ ...data }) 写库，覆盖从未提交的字段。
  // 契约层校验见 app.contract.test.ts（PUT / PATCH 请求体属性不得携带 default）。
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='partial']",
          message: '禁止直接调用 .partial()：请改用 partialForUpdate()（@zenith/shared/core），否则字段省略时会注入 .default() 并覆盖未提交的字段。',
        },
      ],
    },
  },
  // 列表查询链路纪律（constraints.md → Shared 层 / Service 层 / WHERE 条件构造 / 分页格式）：
  // 入参类型只从契约派生、默认值只在契约声明、WHERE 静态条件直接写成 buildWhere 实参。
  // 同名规则在更窄的 files 块中整体覆盖而非合并，这里要把 .partial() 那条一并带上。
  {
    files: ['src/services/**/*.ts', 'src/lib/export-center/**/*.ts'],
    ignores: ['src/services/**/*.test.ts', 'src/lib/export-center/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='partial']",
          message: '禁止直接调用 .partial()：请改用 partialForUpdate()（@zenith/shared/core），否则字段省略时会注入 .default() 并覆盖未提交的字段。',
        },
        {
          selector: "TSInterfaceDeclaration TSPropertySignature[key.name='pageSize']",
          message: '禁止在 service 手写含 pageSize 的查询入参 interface：列表函数入参写 QueryOutputOf<typeof xxxContract.op>（@zenith/shared/core），筛选子集用 Omit<…, \'page\' | \'pageSize\'>。',
        },
        {
          selector: "CallExpression[callee.name='and'][arguments.length=1] > SpreadElement",
          message: '禁止 and(...conditions)：可选条件用 buildWhere(...)（lib/where-helpers）合并，静态条件直接写成实参。',
        },
        {
          selector: "CallExpression[callee.name='buildWhere'][arguments.length=1] > SpreadElement",
          message: '静态条件序列直接写成 buildWhere(cond1, flag ? cond2 : undefined, ...) 的实参，不要先攒 conditions 数组；只有循环 / 数据驱动拼装才保留数组并加 eslint-disable 注明理由。',
        },
        {
          selector: "ObjectPattern > Property[key.name=/^(page|pageSize)$/] > AssignmentPattern",
          message: '禁止在 service 重复分页默认值：page / pageSize 的默认值只在契约 paginationQuery 声明，入参类型用 QueryOutputOf 后二者为必填 number。',
        },
        {
          selector: "LogicalExpression[operator='??'][left.property.name=/^(page|pageSize)$/][right.type='Literal']",
          message: '禁止 q.page ?? 1 / q.pageSize ?? 10：分页默认值只在契约 paginationQuery 声明，入参类型用 QueryOutputOf。',
        },
      ],
    },
  },
  // 通知渠道收口：业务域一律通过 notify() 发事件通知，不得直接调底层渠道。
  // 绕过统一入口就等于绕过收件人偏好、免打扰、幂等与派发留痕——
  // 而「明明配好了却没人收到」的排查完全依赖这些留痕。
  {
    files: ['src/**/*.ts'],
    ignores: [
      // 通知中心自身：适配器与派发层就是要调底层渠道
      'src/lib/notification/**',
      // 消息域：邮件/短信/站内信的管理与手动发送接口
      'src/services/messaging/**',
      // 事务性发信，不属于事件通知：登录验证码、密码重置
      'src/services/identity/auth.service.ts',
      'src/services/member/member-sms.service.ts',
      'src/services/member/member-sms.service.test.ts',
      // 用户在流程/补偿动作里显式编排的发信节点，收件人与内容都由配置指定
      'src/services/workflow/workflow-connectors.service.ts',
      'src/lib/workflow-jobs/handlers/compensation-action.ts',
      // 订阅式投递：收件人来自订阅配置而非事件收件人模型
      'src/services/report/report-delivery.service.ts',
      'src/services/cms/cms-forms.service.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/email'],
              importNames: ['sendMail'],
              message: '事件通知请改用 notify()（services/messaging/notification-outbox.service），邮件渠道由通知中心适配器负责。',
            },
            {
              group: ['**/lib/sms-sender'],
              importNames: ['sendSmsByProvider'],
              message: '事件通知请改用 notify()，短信渠道由通知中心适配器负责。',
            },
            {
              group: ['**/lib/webhook-notify'],
              importNames: ['sendWebhookNotification'],
              message: '事件通知请改用 notify()，Webhook 渠道由通知中心适配器负责。',
            },
            {
              group: ['**/chat/chat-notify.service'],
              importNames: ['notifyUserWithCard', 'notifyUsersWithCard'],
              message: '事件通知请改用 notify() 并指定 chat 渠道。',
            },
          ],
        },
      ],
    },
  },
  // Node 启动/构建脚本（纯 JS，需要声明 Node 运行时全局）
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
