import { PROMPT_POLICY, promptText } from './policy';

export interface EditInstruction { id: number; text: string }
export const MAX_INSTRUCTIONS = 12;
const BASE = 'Edit the original live camera video using only the instructions below. Preserve all unspecified people, objects, appearance, motion and lighting. Do not retain edits from instructions that are no longer listed. If instructions conflict, the later instruction takes priority.';

/** 每次从当前列表合成完整状态，不把删除命令叠加到旧画面上。空列表由调用方停止生成并显示原画。 */
export function composePrompt(items: readonly EditInstruction[]): string {
  if (items.length > MAX_INSTRUCTIONS) throw new Error('本次最多保留12条提示词，请先删除不需要的内容。');
  if (!items.length) return '';
  return promptStateText(`${BASE}\n\n${items.map((item, index) => `${index + 1}. ${promptText(item.text)}`).join('\n')}`);
}

export function promptStateText(value: string): string {
  const text = value.trim();
  if (!text || text.length > PROMPT_POLICY.maxStateLength) throw new Error('提示词组合过长，请删减后再发送。');
  return text;
}
