import type { NextFunction, Request, Response } from 'express';

/** 统一的业务异常：抛出后由全局错误中间件转成 JSON */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** express 4 不会自动捕获 async 里的 reject，统一包一层 */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown> | unknown
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  // zod 的校验错误在路由里已经转成 HttpError，走到这里基本是真 bug
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal', message: '服务器内部错误' });
}

import { z } from 'zod';

/** 校验请求体，失败统一抛 400，只回第一条错误，够前端弹提示用了 */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join('.') || '参数'}: ${first.message}` : '参数不合法', 'bad_request');
  }
  return r.data;
}
