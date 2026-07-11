import {
  DEPLOY_LOCK_TTL_MS,
  createRedisConnection,
  deployLockKey,
} from './deploy.constants';

interface RedisConn {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number | null;
}
const asConn = (): RedisConn => createRedisConnection() as RedisConn;

describe('deploy constants', () => {
  it('namespaces the deploy lock key by service id', () => {
    expect(deployLockKey('svc-123')).toBe('deploy:lock:svc-123');
  });

  it('exposes a positive lock TTL', () => {
    expect(DEPLOY_LOCK_TTL_MS).toBeGreaterThan(0);
  });

  describe('createRedisConnection', () => {
    const original = process.env.REDIS_URL;
    afterEach(() => {
      process.env.REDIS_URL = original;
    });

    it('parses host, port, password and db from REDIS_URL', () => {
      process.env.REDIS_URL = 'redis://:s3cret@redis.example.com:6390/3';
      const conn = asConn();
      expect(conn.host).toBe('redis.example.com');
      expect(conn.port).toBe(6390);
      expect(conn.password).toBe('s3cret');
      expect(conn.db).toBe(3);
      expect(conn.maxRetriesPerRequest).toBeNull();
    });

    it('falls back to localhost defaults when REDIS_URL is unset', () => {
      delete process.env.REDIS_URL;
      const conn = asConn();
      expect(conn.host).toBe('localhost');
      expect(conn.port).toBe(6379);
      expect(conn.db).toBeUndefined();
    });
  });
});
