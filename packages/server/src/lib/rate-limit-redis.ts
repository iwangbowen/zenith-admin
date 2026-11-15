import { createRedisClient } from './redis';
/** Separate bounded command queue: a limiter outage must not hang API requests. */
export const limiterRedis = createRedisClient({ enableOfflineQueue: false, commandTimeout: 750, maxRetriesPerRequest: 0 });
