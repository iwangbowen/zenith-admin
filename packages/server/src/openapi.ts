/**
 * OpenAPI 3.0 Specification for Zenith Admin API
 *
 * 挂载路由：
 *   GET /api/openapi.json  — 返回此 spec
 *   GET /api/docs          — Swagger UI
 */

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Zenith Admin API',
    version: '0.1.1',
    description:
      'Zenith Admin 后台管理系统 REST API 文档。\n\n' +
      '认证方式：Bearer Token（在 Authorize 中填入登录返回的 `accessToken`）。\n\n' +
      '所有接口的成功响应格式为 `{ code: 0, message: "success", data: T }`，' +
      '失败时 `code` 为非零值。',
    contact: {
      name: 'Zenith Admin',
      url: 'https://github.com/iwangbowen/zenith-admin',
    },
  },
  servers: [{ url: '/api', description: '当前服务器' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '登录后获取的 accessToken，格式：`Bearer <token>`',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 0 },
          message: { type: 'string', example: 'success' },
          data: { description: '业务数据，结构因接口而异' },
        },
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          list: { type: 'array', items: {} },
          total: { type: 'integer', example: 100 },
          page: { type: 'integer', example: 1 },
          pageSize: { type: 'integer', example: 10 },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          username: { type: 'string', example: 'admin' },
          nickname: { type: 'string', example: '管理员' },
          email: { type: 'string', example: 'admin@example.com' },
          phone: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'disabled'], example: 'active' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          code: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'disabled'] },
        },
      },
      Menu: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          parentId: { type: 'integer' },
          title: { type: 'string' },
          name: { type: 'string', nullable: true },
          path: { type: 'string', nullable: true },
          component: { type: 'string', nullable: true },
          type: { type: 'string', enum: ['directory', 'menu', 'button'] },
          sort: { type: 'integer' },
          status: { type: 'string', enum: ['active', 'disabled'] },
          permission: { type: 'string', nullable: true },
        },
      },
      OperationLog: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string', nullable: true },
          module: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          method: { type: 'string', nullable: true },
          path: { type: 'string', nullable: true },
          ip: { type: 'string', nullable: true },
          requestBody: { type: 'string', nullable: true },
          responseCode: { type: 'integer', nullable: true },
          duration: { type: 'integer', nullable: true },
          beforeData: { type: 'string', nullable: true, description: '操作前实体快照（JSON 字符串）' },
          afterData: { type: 'string', nullable: true, description: '操作后实体快照（JSON 字符串）' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      SystemConfig: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          configKey: { type: 'string', example: 'captcha_enabled' },
          configValue: { type: 'string', example: 'false' },
          configType: { type: 'string', enum: ['string', 'number', 'boolean', 'json'] },
          description: { type: 'string', nullable: true },
        },
      },
      CronJob: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          cronExpression: { type: 'string', example: '0 */5 * * * *' },
          handler: { type: 'string' },
          params: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'disabled'] },
          description: { type: 'string', nullable: true },
          lastRunAt: { type: 'string', format: 'date-time', nullable: true },
          nextRunAt: { type: 'string', format: 'date-time', nullable: true },
          lastRunStatus: { type: 'string', nullable: true },
        },
      },
    },
    parameters: {
      PageParam: { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
      PageSizeParam: { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 10 } },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ─── Auth ────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['认证'],
        summary: '用户登录',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin' },
                  password: { type: 'string', example: '123456' },
                  captchaId: { type: 'string', description: '验证码 ID（开启验证码时必填）' },
                  captchaCode: { type: 'string', description: '验证码文字（开启验证码时必填）' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: '登录成功',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/ApiResponse' },
                    {
                      properties: {
                        data: {
                          type: 'object',
                          properties: {
                            accessToken: { type: 'string' },
                            refreshToken: { type: 'string' },
                            user: { $ref: '#/components/schemas/User' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          '400': { description: '参数错误' },
          '423': { description: '账号已锁定（登录失败次数过多）' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['认证'],
        summary: '退出登录',
        responses: { '200': { description: '退出成功' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['认证'],
        summary: '刷新 AccessToken',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Token 刷新成功' } },
      },
    },
    '/auth/captcha': {
      get: {
        tags: ['认证'],
        summary: '获取验证码（SVG）',
        security: [],
        responses: {
          '200': {
            description: 'SVG 验证码',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    svg: { type: 'string', description: 'SVG 字符串' },
                  },
                },
              },
            },
          },
        },
      },
    },
    // ─── Users ────────────────────────────────────────────────────────────────
    '/users': {
      get: {
        tags: ['用户管理'],
        summary: '用户列表（分页）',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/PageSizeParam' },
          { name: 'keyword', in: 'query', description: '用户名 / 昵称模糊搜索', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'disabled'] } },
          { name: 'departmentId', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: '用户分页列表' } },
      },
      post: {
        tags: ['用户管理'],
        summary: '新增用户',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'nickname'],
                properties: {
                  username: { type: 'string' },
                  nickname: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                  roleIds: { type: 'array', items: { type: 'integer' } },
                  departmentId: { type: 'integer', nullable: true },
                },
              },
            },
          },
        },
        responses: { '200': { description: '创建成功' } },
      },
    },
    '/users/{id}': {
      get: { tags: ['用户管理'], summary: '获取用户详情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '用户信息' } } },
      put: { tags: ['用户管理'], summary: '更新用户', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['用户管理'], summary: '删除用户', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/users/{id}/lock': {
      delete: {
        tags: ['用户管理'],
        summary: '解除用户登录锁定',
        description: '清除 Redis 中该用户的登录失败计数和锁定标记，使其可以再次登录。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: '解锁成功' }, '404': { description: '用户不存在' } },
      },
    },
    // ─── Roles ────────────────────────────────────────────────────────────────
    '/roles': {
      get: { tags: ['角色管理'], summary: '角色列表（分页）', parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }], responses: { '200': { description: '角色列表' } } },
      post: { tags: ['角色管理'], summary: '新增角色', responses: { '200': { description: '创建成功' } } },
    },
    '/roles/{id}': {
      put: { tags: ['角色管理'], summary: '更新角色', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['角色管理'], summary: '删除角色', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    // ─── Menus ────────────────────────────────────────────────────────────────
    '/menus': {
      get: { tags: ['菜单管理'], summary: '菜单树（全量）', responses: { '200': { description: '菜单列表' } } },
      post: { tags: ['菜单管理'], summary: '新增菜单', responses: { '200': { description: '创建成功' } } },
    },
    // ─── Operation Logs ───────────────────────────────────────────────────────
    '/operation-logs': {
      get: {
        tags: ['操作日志'],
        summary: '操作日志列表（分页）',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/PageSizeParam' },
          { name: 'username', in: 'query', schema: { type: 'string' } },
          { name: 'module', in: 'query', schema: { type: 'string' } },
          { name: 'description', in: 'query', schema: { type: 'string' } },
          { name: 'method', in: 'query', schema: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] } },
          { name: 'path', in: 'query', schema: { type: 'string' } },
          { name: 'ip', in: 'query', description: 'IP 地址模糊搜索', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'fail'] } },
          { name: 'startTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: '操作日志分页列表',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/ApiResponse' },
                    { properties: { data: { allOf: [{ $ref: '#/components/schemas/PaginatedResponse' }, { properties: { list: { type: 'array', items: { $ref: '#/components/schemas/OperationLog' } } } }] } } },
                  ],
                },
              },
            },
          },
        },
      },
    },
    // ─── System Configs ──────────────────────────────────────────────────────
    '/system-configs': {
      get: {
        tags: ['系统配置'],
        summary: '系统配置列表（分页）',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }],
        responses: { '200': { description: '系统配置列表' } },
      },
      post: { tags: ['系统配置'], summary: '新增系统配置', responses: { '200': { description: '创建成功' } } },
    },
    '/system-configs/{id}': {
      put: { tags: ['系统配置'], summary: '更新系统配置', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['系统配置'], summary: '删除系统配置', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    // ─── Cron Jobs ────────────────────────────────────────────────────────────
    '/cron-jobs': {
      get: { tags: ['定时任务'], summary: '定时任务列表（分页）', parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }], responses: { '200': { description: '定时任务列表' } } },
      post: { tags: ['定时任务'], summary: '新增定时任务', responses: { '200': { description: '创建成功' } } },
    },
    '/cron-jobs/{id}': {
      put: { tags: ['定时任务'], summary: '更新定时任务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['定时任务'], summary: '删除定时任务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/cron-jobs/{id}/execute': {
      post: { tags: ['定时任务'], summary: '立即执行任务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '执行结果' } } },
    },
    '/cron-jobs/{id}/logs': {
      get: {
        tags: ['定时任务'],
        summary: '任务执行历史记录（分页）',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/PageSizeParam' },
        ],
        responses: { '200': { description: '执行日志分页列表' } },
      },
    },
    // ─── Health ───────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['服务状态'],
        summary: '健康检查（无需认证）',
        security: [],
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'degraded'] },
                    version: { type: 'string' },
                    uptime: { type: 'number' },
                    checks: {
                      type: 'object',
                      properties: {
                        database: { type: 'string', enum: ['ok', 'error'] },
                        redis: { type: 'string', enum: ['ok', 'error'] },
                      },
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '503': { description: '服务降级（数据库或 Redis 异常）' },
        },
      },
    },
  },
  tags: [
    { name: '认证', description: '登录、登出、Token 刷新、验证码' },
    { name: '用户管理', description: '用户 CRUD 及锁定管理' },
    { name: '角色管理', description: '角色 CRUD 及菜单权限分配' },
    { name: '菜单管理', description: '菜单 / 按钮权限树管理' },
    { name: '操作日志', description: '系统操作日志查询（含变更 diff）' },
    { name: '系统配置', description: '内置系统配置项的读写' },
    { name: '定时任务', description: '定时任务管理及执行历史' },
    { name: '服务状态', description: '健康检查，无需认证' },
  ],
};
