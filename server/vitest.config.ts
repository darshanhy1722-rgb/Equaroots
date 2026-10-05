import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://equaroots:equaroots@localhost:5432/equaroots_test',
      CAL_WEBHOOK_SECRET: 'test-secret',
      AUTH_DEV_LOGIN: 'true',
      ADMIN_EMAILS: 'admin@example.com',
      LOCAL_STORAGE_DIR: './data/test-pdfs',
      SENDGRID_API_KEY: '',
      STORAGE_BUCKET: '',
    },
  },
});
