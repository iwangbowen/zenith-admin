import Redis from 'ioredis';
import { config } from '../config';
import logger from './logger';

function createRedisClient(): Redis {
  const redisConfig = config.redis;

  /**
   * 自动流水线：同一事件循环 tick 内发出的命令合并为一次网络往返。
   * 鉴权链路每请求并行发 EXISTS（黑名单）+ GETEX（会话续期）+ GET（权限缓存），开启后只剩一次 RTT；
   * 高并发下跨请求的命令也会被合并。共享客户端上没有阻塞命令（BLPOP / SUBSCRIBE 等），无兼容风险。
   */
  const sharedOptions = { lazyConnect: true, enableAutoPipelining: true } as const;

  let client: Redis;
  if (redisConfig.url) {
    client = new Redis(redisConfig.url, sharedOptions);
  } else {
    client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      ...sharedOptions,
    });
  }

  client.on('connect', () => {
    logger.info('[Redis] 连接成功');
  });

  client.on('error', (err) => {
    logger.error(`[Redis] 连接错误: ${err.message}`);
  });

  client.connect().catch((err) => {
    logger.warn(`[Redis] 初始连接失败，将在请求时重试: ${err.message}`);
  });

  return client;
}

const redis = createRedisClient();

export async function closeRedis(): Promise<void> {
  await redis.quit();
}

export default redis;
