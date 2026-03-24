import Redis from 'ioredis';
import { config } from '../config';
import logger from './logger';

function createRedisClient(): Redis {
  const redisConfig = config.redis;

  let client: Redis;
  if (redisConfig.url) {
    client = new Redis(redisConfig.url, { lazyConnect: true });
  } else {
    client = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      lazyConnect: true,
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

export default redis;
