import postgres from 'postgres';

/** 应用连接的会话参数：时区固定 UTC——应用 SQL 的行为与数据库服务端、宿主机的时区设置无关 */
export const PG_SESSION_PARAMETERS = { TimeZone: 'UTC' } as const;

type PgClientOptions = NonNullable<Parameters<typeof postgres>[1]>;

/** 连接主库的唯一入口：运行时连接池、迁移、集成测试都经由它创建客户端 */
export function createPgClient(url: string, options: PgClientOptions = {}) {
  return postgres(url, {
    ...options,
    connection: { ...options.connection, ...PG_SESSION_PARAMETERS },
  });
}
