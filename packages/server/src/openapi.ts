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
    '/users/{id}/unlock': {
      post: {
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
    '/cron-jobs/{id}/run': {
      post: { tags: ['定时任务'], summary: '立即执行任务', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '执行成功' } } },
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
    // ─── Auth 补全 ────────────────────────────────────────────────────────────
    '/auth/me': {
      get: { tags: ['认证'], summary: '获取当前登录用户信息', responses: { '200': { description: '当前用户信息' } } },
    },
    '/auth/profile': {
      put: {
        tags: ['认证'],
        summary: '更新个人资料',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nickname: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, avatar: { type: 'string' } } } } } },
        responses: { '200': { description: '更新成功' } },
      },
    },
    '/auth/password': {
      put: {
        tags: ['认证'],
        summary: '修改密码',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['oldPassword', 'newPassword'], properties: { oldPassword: { type: 'string' }, newPassword: { type: 'string' } } } } } },
        responses: { '200': { description: '修改成功' }, '400': { description: '旧密码错误' } },
      },
    },
    '/auth/my-login-logs': {
      get: {
        tags: ['认证'],
        summary: '我的登录记录',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }],
        responses: { '200': { description: '登录日志分页列表' } },
      },
    },
    '/auth/my-operation-logs': {
      get: {
        tags: ['认证'],
        summary: '我的操作记录',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }],
        responses: { '200': { description: '操作日志分页列表' } },
      },
    },
    // ─── Users 补全 ──────────────────────────────────────────────────────────
    '/users/export': {
      get: { tags: ['用户管理'], summary: '导出用户列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    '/users/batch': {
      delete: {
        tags: ['用户管理'],
        summary: '批量删除用户',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': { description: '批量删除成功' } },
      },
    },
    '/users/batch-status': {
      put: {
        tags: ['用户管理'],
        summary: '批量更新用户状态',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids', 'status'], properties: { ids: { type: 'array', items: { type: 'integer' } }, status: { type: 'string', enum: ['active', 'disabled'] } } } } } },
        responses: { '200': { description: '更新成功' } },
      },
    },
    '/users/{id}/password': {
      put: {
        tags: ['用户管理'],
        summary: '重置用户密码',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string' } } } } } },
        responses: { '200': { description: '重置成功' } },
      },
    },
    // ─── Roles 补全 ──────────────────────────────────────────────────────────
    '/roles/export': {
      get: { tags: ['角色管理'], summary: '导出角色列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    '/roles/{id}/menus': {
      put: {
        tags: ['角色管理'],
        summary: '分配角色菜单权限',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['menuIds'], properties: { menuIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': { description: '分配成功' } },
      },
    },
    '/roles/{id}/users': {
      get: {
        tags: ['角色管理'],
        summary: '获取角色下的用户列表',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }],
        responses: { '200': { description: '用户分页列表' } },
      },
      put: {
        tags: ['角色管理'],
        summary: '更新角色用户',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['userIds'], properties: { userIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': { description: '更新成功' } },
      },
    },
    // ─── Menus 补全 ──────────────────────────────────────────────────────────
    '/menus/{id}': {
      put: { tags: ['菜单管理'], summary: '更新菜单', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['菜单管理'], summary: '删除菜单', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/menus/user': {
      get: { tags: ['菜单管理'], summary: '获取当前用户可见菜单树', responses: { '200': { description: '菜单树' } } },
    },
    '/menus/flat': {
      get: { tags: ['菜单管理'], summary: '获取全量菜单（扁平列表）', responses: { '200': { description: '扁平菜单列表' } } },
    },
    // ─── Departments ─────────────────────────────────────────────────────────
    '/departments': {
      get: {
        tags: ['部门管理'],
        summary: '部门列表（树形）',
        parameters: [{ name: 'keyword', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'disabled'] } }],
        responses: { '200': { description: '部门树' } },
      },
      post: {
        tags: ['部门管理'],
        summary: '新增部门',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: 'integer' }, code: { type: 'string' }, leader: { type: 'string' }, sort: { type: 'integer' } } } } } },
        responses: { '200': { description: '创建成功' } },
      },
    },
    '/departments/{id}': {
      put: { tags: ['部门管理'], summary: '更新部门', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['部门管理'], summary: '删除部门', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/departments/flat': {
      get: { tags: ['部门管理'], summary: '部门扁平列表', responses: { '200': { description: '扁平列表' } } },
    },
    '/departments/export': {
      get: { tags: ['部门管理'], summary: '导出部门列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── Positions ───────────────────────────────────────────────────────────
    '/positions': {
      get: {
        tags: ['岗位管理'],
        summary: '岗位列表（分页）',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }, { name: 'keyword', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'disabled'] } }],
        responses: { '200': { description: '岗位分页列表' } },
      },
      post: { tags: ['岗位管理'], summary: '新增岗位', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'code'], properties: { name: { type: 'string' }, code: { type: 'string' }, sort: { type: 'integer' }, remark: { type: 'string' } } } } } }, responses: { '200': { description: '创建成功' } } },
    },
    '/positions/{id}': {
      put: { tags: ['岗位管理'], summary: '更新岗位', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['岗位管理'], summary: '删除岗位', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/positions/batch': {
      delete: {
        tags: ['岗位管理'],
        summary: '批量删除岗位',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': { description: '批量删除成功' } },
      },
    },
    '/positions/export': {
      get: { tags: ['岗位管理'], summary: '导出岗位列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── Dicts ───────────────────────────────────────────────────────────────
    '/dicts': {
      get: {
        tags: ['字典管理'],
        summary: '字典列表（分页）',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }, { name: 'keyword', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: '字典分页列表' } },
      },
      post: { tags: ['字典管理'], summary: '新增字典', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'code'], properties: { name: { type: 'string' }, code: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { '200': { description: '创建成功' } } },
    },
    '/dicts/{id}': {
      put: { tags: ['字典管理'], summary: '更新字典', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['字典管理'], summary: '删除字典', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/dicts/{id}/items': {
      get: {
        tags: ['字典管理'],
        summary: '获取字典项列表',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: '字典项列表' } },
      },
      post: {
        tags: ['字典管理'],
        summary: '新增字典项',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' }, color: { type: 'string' }, sort: { type: 'integer' }, remark: { type: 'string' } } } } } },
        responses: { '200': { description: '创建成功' } },
      },
    },
    '/dicts/{id}/items/{itemId}': {
      put: { tags: ['字典管理'], summary: '更新字典项', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'itemId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['字典管理'], summary: '删除字典项', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'itemId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/dicts/code/{code}/items': {
      get: { tags: ['字典管理'], summary: '按字典 code 获取字典项（供前端下拉使用）', parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '字典项列表' } } },
    },
    '/dicts/export': {
      get: { tags: ['字典管理'], summary: '导出字典列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── File Storage Configs ─────────────────────────────────────────────────
    '/file-storage-configs': {
      get: { tags: ['文件存储配置'], summary: '存储配置列表', responses: { '200': { description: '存储配置列表' } } },
      post: {
        tags: ['文件存储配置'],
        summary: '新增存储配置',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'provider'], properties: { name: { type: 'string' }, provider: { type: 'string', enum: ['local', 'oss'] }, basePath: { type: 'string' }, localRootPath: { type: 'string' }, ossRegion: { type: 'string' }, ossBucket: { type: 'string' }, ossAccessKeyId: { type: 'string' }, ossAccessKeySecret: { type: 'string' } } } } } },
        responses: { '200': { description: '创建成功' } },
      },
    },
    '/file-storage-configs/{id}': {
      put: { tags: ['文件存储配置'], summary: '更新存储配置', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['文件存储配置'], summary: '删除存储配置', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/file-storage-configs/{id}/default': {
      put: { tags: ['文件存储配置'], summary: '设为默认存储配置', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '已设为默认' } } },
    },
    // ─── Files ───────────────────────────────────────────────────────────────
    '/files': {
      get: {
        tags: ['文件管理'],
        summary: '文件列表（分页）',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }, { name: 'keyword', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: '文件分页列表' } },
      },
    },
    '/files/upload': {
      post: {
        tags: ['文件管理'],
        summary: '上传文件',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { '200': { description: '上传成功，返回文件信息' } },
      },
    },
    '/files/{id}': {
      delete: { tags: ['文件管理'], summary: '删除文件', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/files/{id}/content': {
      get: { tags: ['文件管理'], summary: '获取文件内容（下载/预览）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '文件内容' } } },
    },
    // ─── Login Logs ──────────────────────────────────────────────────────────
    '/login-logs': {
      get: {
        tags: ['登录日志'],
        summary: '登录日志列表（分页）',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/PageSizeParam' },
          { name: 'username', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'fail'] } },
          { name: 'ip', in: 'query', schema: { type: 'string' } },
          { name: 'startTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': { description: '登录日志分页列表' } },
      },
    },
    '/login-logs/export': {
      get: { tags: ['登录日志'], summary: '导出登录日志（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── Sessions ────────────────────────────────────────────────────────────
    '/sessions': {
      get: {
        tags: ['在线会话'],
        summary: '在线会话列表',
        parameters: [{ name: 'keyword', in: 'query', schema: { type: 'string' }, description: '用户名搜索' }],
        responses: { '200': { description: '在线会话列表' } },
      },
    },
    '/sessions/{tokenId}': {
      delete: {
        tags: ['在线会话'],
        summary: '强制下线指定会话',
        parameters: [{ name: 'tokenId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '强制下线成功' }, '404': { description: '会话不存在' } },
      },
    },
    // ─── Monitor ─────────────────────────────────────────────────────────────
    '/monitor/info': {
      get: { tags: ['服务监控'], summary: '获取服务器/应用运行状态', responses: { '200': { description: '系统监控信息' } } },
    },
    // ─── Notices ─────────────────────────────────────────────────────────────
    '/notices': {
      get: {
        tags: ['通知公告'],
        summary: '通知公告列表（分页）',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/PageSizeParam' },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'publishStatus', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: '通知公告分页列表' } },
      },
      post: { tags: ['通知公告'], summary: '新增通知公告', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'content', 'type', 'priority'], properties: { title: { type: 'string' }, content: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' } } } } } }, responses: { '200': { description: '创建成功' } } },
    },
    '/notices/{id}': {
      get: { tags: ['通知公告'], summary: '获取通知公告详情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '通知公告详情' } } },
      put: { tags: ['通知公告'], summary: '更新通知公告', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['通知公告'], summary: '删除通知公告', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/notices/batch': {
      delete: {
        tags: ['通知公告'],
        summary: '批量删除通知公告',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { '200': { description: '批量删除成功' } },
      },
    },
    '/notices/inbox': {
      get: {
        tags: ['通知公告'],
        summary: '我的收件箱（分页）',
        parameters: [{ $ref: '#/components/parameters/PageParam' }, { $ref: '#/components/parameters/PageSizeParam' }],
        responses: { '200': { description: '收件箱列表' } },
      },
    },
    '/notices/published': {
      get: { tags: ['通知公告'], summary: '已发布公告列表（含已读状态）', responses: { '200': { description: '已发布公告列表' } } },
    },
    '/notices/{id}/read': {
      post: { tags: ['通知公告'], summary: '标记通知为已读', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '标记成功' } } },
    },
    '/notices/read-all': {
      post: { tags: ['通知公告'], summary: '全部标记为已读', responses: { '200': { description: '标记成功' } } },
    },
    '/notices/export': {
      get: { tags: ['通知公告'], summary: '导出通知公告（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── Regions ─────────────────────────────────────────────────────────────
    '/regions': {
      get: {
        tags: ['地区管理'],
        summary: '地区列表（树形）',
        parameters: [{ name: 'keyword', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: '地区树' } },
      },
      post: { tags: ['地区管理'], summary: '新增地区', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'code'], properties: { name: { type: 'string' }, code: { type: 'string' }, parentId: { type: 'integer' }, sort: { type: 'integer' } } } } } }, responses: { '200': { description: '创建成功' } } },
    },
    '/regions/{id}': {
      put: { tags: ['地区管理'], summary: '更新地区', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '更新成功' } } },
      delete: { tags: ['地区管理'], summary: '删除地区', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: '删除成功' } } },
    },
    '/regions/flat': {
      get: { tags: ['地区管理'], summary: '地区扁平列表', responses: { '200': { description: '扁平列表' } } },
    },
    // ─── CronJobs 补全 ───────────────────────────────────────────────────────
    '/cron-jobs/handlers': {
      get: { tags: ['定时任务'], summary: '获取已注册的处理器名称列表', responses: { '200': { description: '处理器名称数组' } } },
    },
    '/cron-jobs/validate': {
      post: {
        tags: ['定时任务'],
        summary: '验证 Cron 表达式是否合法',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expression'], properties: { expression: { type: 'string', example: '0 */5 * * * *' } } } } } },
        responses: { '200': { description: '{ valid: boolean }' } },
      },
    },
    '/cron-jobs/{id}/status': {
      put: {
        tags: ['定时任务'],
        summary: '切换定时任务启用/禁用状态',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'disabled'] } } } } } },
        responses: { '200': { description: '状态切换成功' } },
      },
    },
    '/cron-jobs/export': {
      get: { tags: ['定时任务'], summary: '导出定时任务列表（Excel）', responses: { '200': { description: 'Excel 文件' } } },
    },
    // ─── Dashboard ───────────────────────────────────────────────────────────
    '/dashboard/stats': {
      get: {
        tags: ['首页'],
        summary: '获取首页统计数据（仅超级管理员）',
        responses: {
          '200': {
            description: '统计数据',
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
                            totalUsers: { type: 'integer', description: '系统用户总数' },
                            activeUsers: { type: 'integer', description: '活跃用户数' },
                            onlineUsers: { type: 'integer', description: '当前在线人数' },
                            todayLogins: { type: 'integer', description: '今日登录次数' },
                            todayOperations: { type: 'integer', description: '今日操作次数' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          '403': { description: '无权限（非超级管理员）' },
        },
      },
    },
    // ─── Email Config ─────────────────────────────────────────────────────────
    '/email-config': {
      get: { tags: ['邮件配置'], summary: '获取邮件配置', responses: { '200': { description: 'SMTP配置信息' } } },
      put: {
        tags: ['邮件配置'],
        summary: '保存邮件配置',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  smtpHost: { type: 'string', example: 'smtp.example.com' },
                  smtpPort: { type: 'integer', example: 465 },
                  smtpUser: { type: 'string', example: 'noreply@example.com' },
                  smtpPassword: { type: 'string' },
                  fromName: { type: 'string', example: 'Zenith Admin' },
                  fromEmail: { type: 'string' },
                  encryption: { type: 'string', enum: ['none', 'ssl', 'tls'], example: 'ssl' },
                  status: { type: 'string', enum: ['active', 'disabled'] },
                },
              },
            },
          },
        },
        responses: { '200': { description: '保存成功' } },
      },
    },
    '/email-config/test': {
      post: {
        tags: ['邮件配置'],
        summary: '发送测试邮件',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } },
        responses: { '200': { description: '发送成功' }, '400': { description: 'SMTP配置不完整' }, '500': { description: '发送失败' } },
      },
    },
    // ─── User Import ──────────────────────────────────────────────────────────
    '/users/import-template': {
      get: { tags: ['用户管理'], summary: '下载用户导入模板（Excel）', responses: { '200': { description: 'Excel 模板文件' } } },
    },
    '/users/import': {
      post: {
        tags: ['用户管理'],
        summary: '批量导入用户（Excel）',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: '用户导入 Excel 文件' } } } } } },
        responses: { '200': { description: '导入结果', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' }, success: { type: 'integer' }, failed: { type: 'integer' }, errors: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, message: { type: 'string' } } } } } } } } } },
      },
    },
    // ─── Password Policy ─────────────────────────────────────────────────────
    '/system-configs/password-policy': {
      get: {
        tags: ['系统配置'],
        summary: '获取密码策略（无需认证）',
        security: [],
        responses: { '200': { description: '密码策略', content: { 'application/json': { schema: { type: 'object', properties: { minLength: { type: 'integer', example: 8 }, requireUppercase: { type: 'boolean' }, requireSpecialChar: { type: 'boolean' } } } } } } },
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
    { name: '认证', description: '登录、登出、Token 刷新、验证码、个人资料' },
    { name: '首页', description: '首页统计数据' },
    { name: '用户管理', description: '用户 CRUD、锁定解锁、批量操作、密码重置' },
    { name: '角色管理', description: '角色 CRUD 及菜单权限分配' },
    { name: '菜单管理', description: '菜单 / 按钮权限树管理' },
    { name: '部门管理', description: '部门 CRUD 及树形结构' },
    { name: '岗位管理', description: '岗位 CRUD' },
    { name: '字典管理', description: '数据字典及字典项管理' },
    { name: '文件存储配置', description: '本地 / OSS 存储配置管理' },
    { name: '文件管理', description: '文件上传、下载、删除' },
    { name: '登录日志', description: '用户登录记录查询' },
    { name: '操作日志', description: '系统操作日志查询（含变更 diff）' },
    { name: '在线会话', description: '在线用户管理及强制下线' },
    { name: '服务监控', description: 'CPU / 内存 / 磁盘等服务器状态' },
    { name: '通知公告', description: '通知公告 CRUD、发布、收件箱' },
    { name: '地区管理', description: '行政地区 CRUD' },
    { name: '系统配置', description: '内置系统配置项的读写、密码策略' },
    { name: '定时任务', description: '定时任务管理及执行历史' },
    { name: '邮件配置', description: 'SMTP 邮件服务器配置及测试' },
    { name: '服务状态', description: '健康检查，无需认证' },
  ],
};
