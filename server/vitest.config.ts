import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // 每个测试文件一个独立 worker：db.ts 是模块级单例，
    // 隔离到文件级 = 每个文件拿到自己的内存库，互不污染
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000
  }
});
