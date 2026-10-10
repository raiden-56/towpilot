import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://towpilot:towpilot@127.0.0.1:5455/towpilot_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
      SMS_PROVIDER: 'sandbox',
      EXPOSE_SANDBOX_OTP: 'true',
      PAYMENT_PROVIDER: 'sandbox',
      MAPS_PROVIDER: 'sandbox',
      STORAGE_LOCAL_DIR: './storage-test',
      RUN_WORKER: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
