/**
 * AI 助手的服务端代理。
 *
 * 以前 Key 随 /api/auth/me 下发到浏览器、由浏览器直连 LLM 服务商——个人用没问题，
 * 但「服务器存着明文 Key 还到处发」这个故事在面试里讲不圆。现在：
 * - Key 只存 team_settings.ai，永不回传（getSettings 里打码）
 * - 浏览器只把 messages 发给本接口，服务器带着存的 Key 去请求服务商，
 *   并把 SSE 流原样透传回去（前端解析逻辑一行不用改）
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../db';
import { asyncHandler, parse, HttpError } from '../http';
import { requireAuth, requireRole, type AuthedRequest } from '../auth';

const router = Router();

/** 读库里的原始 AI 配置（不 mask，只有服务端能用） */
function rawAi(teamId: string): { base: string; model: string; key: string } | null {
  const row = db.prepare('SELECT ai FROM team_settings WHERE team_id = ?').get(teamId) as
    | { ai: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.ai || 'null') as { base?: string; model?: string; key?: string } | null;
    if (!parsed || !parsed.key) return null;
    return {
      base: String(parsed.base || 'https://api.deepseek.com'),
      model: String(parsed.model || 'deepseek-chat'),
      key: String(parsed.key)
    };
  } catch {
    return null;
  }
}

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(12000)
      })
    )
    .min(1)
    .max(30),
  temperature: z.number().min(0).max(2).default(0.7)
});

function upstreamUrl(base: string): string {
  const b = String(base || '').trim().replace(/\/+$/, '');
  return /chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

router.post(
  '/chat',
  requireAuth,
  requireRole('admin', 'coach'),
  asyncHandler(async (req, res) => {
    const r = req as unknown as AuthedRequest;
    const b = parse(chatSchema, req.body);
    const ai = rawAi(r.teamId);
    if (!ai) throw new HttpError(400, '球队还没配置 AI（先在 AI 页保存 API Key）', 'no_ai_config');

    // 客户端中断（点停止 / 关页面）时同步掐断上游请求，不白白烧钱。
    // 注意挂在 res 上而不是 req：Node 18+ 里 req 的 'close' 在请求体读完后就会触发，
    // 挂 req 等于请求一进来就把上游 abort 掉（实测直接 500）。
    const upstream = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) upstream.abort();
    });

    const ures = await fetch(upstreamUrl(ai.base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` },
      body: JSON.stringify({ model: ai.model, messages: b.messages, stream: true, temperature: b.temperature }),
      signal: upstream.signal
    });

    if (!ures.ok || !ures.body) {
      // 把服务商的错误原样转成 JSON 给前端（前端按 {error:{message}} 解析）
      let detail = '';
      try {
        const j = (await ures.json()) as { error?: { message?: string; code?: string }; message?: string };
        detail = (j.error && (j.error.message || j.error.code)) || j.message || '';
      } catch {
        /* ignore */
      }
      throw new HttpError(ures.status === 401 ? 400 : 502, `AI 服务商返回 ${ures.status}${detail ? `：${detail}` : ''}`, 'upstream_error');
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = ures.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
      res.end();
      db.prepare('UPDATE team_settings SET updated_at = ? WHERE team_id = ?').run(now(), r.teamId);
    }
  })
);

export default router;
