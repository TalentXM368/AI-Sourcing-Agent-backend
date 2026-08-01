import Redis from 'ioredis';

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
    connection.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

export function isRedisAvailable(): boolean {
  return connection !== null && connection.status === 'ready';
}
