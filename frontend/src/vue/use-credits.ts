import {ref, watch, type Ref} from 'vue';
import {envelopeData} from '../lib/api-response';
import type {WalletView} from '../lib/billing';

/** 页面切换和刷新时复用上次已知积分，避免每个创作页都先闪“积分读取中…”。 */
const KEY = 'yingxiang-credits-v1:';
const cache = new Map<string, number>();

function cached(userId: string): number | undefined {
  const known = cache.get(userId);
  if (known !== undefined) return known;
  try {
    const raw = sessionStorage.getItem(KEY + userId);
    const value = raw === null ? NaN : Number(raw);
    if (Number.isInteger(value) && value >= 0) { cache.set(userId, value); return value; }
  } catch { /* 隐私模式禁用存储时仅用内存。 */ }
  return undefined;
}

function remember(userId: string, credits: number) {
  cache.set(userId, credits);
  try { sessionStorage.setItem(KEY + userId, String(credits)); } catch { /* 同上。 */ }
}

async function load(userId: string): Promise<number | null> {
  try {
    const response = await fetch('/api/billing/wallet', {cache: 'no-store'});
    if (!response.ok) return null;
    const view = envelopeData<WalletView>(await response.json());
    remember(userId, view.real.availableCredits);
    return view.real.availableCredits;
  } catch {
    return null;
  }
}

/** 应用外层预取，让进入创作页时通常已有可用积分。 */
export async function prefetchCredits(userId: string | null | undefined) {
  if (userId) { cached(userId); await load(userId); }
}

export function useCredits(userId: Ref<string | null | undefined>) {
  const credits = ref<number | null>(null), failed = ref(false);
  watch(userId, id => {
    failed.value = false;
    if (!id) { credits.value = null; return; }
    credits.value = cached(id) ?? null;
    void load(id).then(value => {
      if (userId.value !== id) return;
      if (value === null) { if (cached(id) === undefined) failed.value = true; }
      else credits.value = value;
    });
  }, {immediate: true});
  return {credits, failed};
}
