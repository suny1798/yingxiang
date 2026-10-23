import type { DurationSec } from './studio/policy';

export interface AccountView {
  user: { id: string; username: string; createdAt: string } | null;
  trial: 'ready' | 'used' | 'review' | null;
  /** 该账号可用的体验总次数；默认1，仅本机测试账号可由数据文件单独放宽。 */
  trialLimit: number;
  /** 扣除已提交连接（含待核查）后的剩余次数。 */
  trialRemaining: number;
  durations: Array<{ seconds: DurationSec; limit: number; remaining: number }>;
  history: Array<{ id: string; createdAt: string; durationSec: DurationSec; state: 'used' | 'review'; outcome?: 'ended' | 'error' }>;
}
