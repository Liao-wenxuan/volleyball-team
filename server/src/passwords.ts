/**
 * 一次性初始密码生成。
 *
 * 去掉 0/O/1/l/I 这些抄错率高的字符（学生拿手机拍屏幕抄码的场景太多）。
 * 此前 routes/accounts.ts 和 cli/account.ts 各有一份，现在抽成共享工具。
 */
import crypto from 'node:crypto';

const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genPassword(len = 10): string {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CHARS[buf[i] % CHARS.length];
  return out;
}
