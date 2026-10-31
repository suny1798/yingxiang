export const PROMPT_POLICY = {
  model: 'lucy-2.6', sdk: '0.2.14', consentVersion: '2026-10-26-prompt-history-v1',
  durationSec: 15, connectionTimeoutMs: 30_000, tokenTtlSec: 10, usdPerSecond: 0.02, maxPromptLength: 500, maxStateLength: 6500,
} as const;
export const PROMPT_EXAMPLES = [
  { label: '换个穿搭', text: '把人物的服装改成米白色针织开衫，保留人物的面部、姿态和背景。' },
  { label: '换个背景', text: '把背景改成阳光照进来的温暖客厅，保留人物的外貌和动作。' },
  { label: '添个摆件', text: '在画面中的桌面上放一盆绿色植物，其他内容保持不变。' },
] as const;
export function promptText(value: string): string {
  const text = value.trim();
  if (!text || text.length > PROMPT_POLICY.maxPromptLength) throw new Error('请输入1—500字符的画面修改指令。');
  return text;
}
export interface PromptStatus { available: boolean; message: string }
