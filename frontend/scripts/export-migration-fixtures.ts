// 固定合同/语言兼容样本；只使用合成身份，不读取运行缓存或环境密钥。
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { scryptSync, createHash } from 'node:crypto';
import { PUBLIC_CONFIG } from '../src/lib/contracts';
import { STUDIO_POLICY } from '../src/lib/studio/policy';
import { PROMPT_POLICY } from '../src/lib/prompt/policy';
import { VIDEO_POLICY } from '../src/lib/video/policy';
const dir = resolve('../backend/contracts'); mkdirSync(dir, { recursive: true });
const salt = '00112233445566778899aabbccddeeff';
const fixture = { publicConfig: PUBLIC_CONFIG, studio: STUDIO_POLICY, prompt: PROMPT_POLICY, video: VIDEO_POLICY,
  passwords: ['test-password-only', '中文密码123456', '👗'.repeat(4), '\ud800abc123456'].map(password => ({password, salt, jsLength: password.length, hash: scryptSync(password, salt, 64, {N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex')})),
  session: { token: 'a'.repeat(64), hash: createHash('sha256').update('a'.repeat(64)).digest('hex') } };
writeFileSync(resolve(dir, 'node-fixtures.json'), JSON.stringify(fixture, null, 2) + '\n');
