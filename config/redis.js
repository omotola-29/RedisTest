import redis from 'redis';

// Create a Redis client with connection to Redis server
export const createRedisClient = async () => {
  try {
    // Create Redis client
    const client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    // Setup event handlers
    client.on('error', (err) => console.error('Redis Error:', err));
    client.on('connect', () => console.log('Redis connected'));
    client.on('reconnecting', () => console.log('Redis reconnecting...'));
    client.on('end', () => console.log('Redis connection closed'));

    // Connect to Redis
    await client.connect();

    return client;
  } catch (err) {
    console.error('Failed to create Redis client:', err);
    
    // Return a mock client that stores data in memory as fallback
    console.log('Using in-memory fallback for Redis');

    const mockStorage = new Map();

    return {
      get: async (key) => mockStorage.get(key) || null,
      set: async (key, value, options) => {
        mockStorage.set(key, value);
        // Handle expiration if EX option provided
        if (options?.EX) {
          setTimeout(() => mockStorage.delete(key), options.EX * 1000);
        }
        return 'OK';
      },
      del: async (key) => (mockStorage.delete(key) ? 1 : 0),
      keys: async (pattern) => {
        const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
        return [...mockStorage.keys()].filter((key) => regex.test(key));
      },
      // Add other Redis commands as needed for your application
      hSet: async () => 'OK',
      hGetAll: async () => ({}),
      zAdd: async () => 1,
      zRange: async () => [],
      zRem: async () => 1,
      exists: async () => 0,
    };
  }
};
