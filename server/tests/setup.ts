/**
 * 测试全局 setup：在任何业务模块被 import 之前定死环境变量。
 *
 * db.ts 在模块加载时读 DB_PATH 并建库 —— 所以必须在 setup 阶段（早于测试文件
 * 的 import）设置。vitest 的 setupFiles 先于测试文件求值，正好卡在这个时机上。
 */
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-volleyball';
process.env.NODE_ENV = 'test';
