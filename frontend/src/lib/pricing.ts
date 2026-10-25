/** 三档展示方案；不作为支付SKU或后端权益，不触发购买、扣分或真实调用。 */
export const CREATION_SCENES = {
  tryon: { label: '实时换装', creditsPerSecond: 1, maxSeconds: 60, examples: [15, 30, 60] },
  video: { label: '视频换装', creditsPerSecond: 2, maxSeconds: 15, examples: [5, 10, 15] },
  edit: { label: '实时编辑', creditsPerSecond: 1, maxSeconds: 15, examples: [15] },
} as const;
export type CreationScene = keyof typeof CREATION_SCENES;
export const CREATION_PLANS = [
  { id: 'light', name: '轻享包', description: '日常试穿，轻松尝试。', priceFen: 3900, credits: 120, validityDays: null, scenes: ['tryon', 'video'], note: '适合偶尔试穿', featured: false },
  { id: 'creator', name: '创作包', description: '三种功能，完整的创作体验。', priceFen: 12900, credits: 450, validityDays: null, scenes: ['tryon', 'video', 'edit'], note: '完整的三功能方案', featured: true },
  { id: 'plus', name: '进阶包', description: '更多积分，留给更多想法。', priceFen: 32900, credits: 1200, validityDays: null, scenes: ['tryon', 'video', 'edit'], note: '更低的积分单价', featured: false },
] as const;
export type CreationPlanId = typeof CREATION_PLANS[number]['id'];
export const money = (fen: number) => (fen / 100).toFixed(2);

export function creditsFor(scene: CreationScene, seconds: number) {
  const policy = CREATION_SCENES[scene];
  if (!Object.hasOwn(CREATION_SCENES, scene) || !policy || !Number.isFinite(seconds) || seconds <= 0 || seconds > policy.maxSeconds) throw new Error('无效的用量示例');
  return Math.ceil(seconds * policy.creditsPerSecond);
}

/** 同一份积分全部用于一个功能的估算次数；不支持的功能返回null，不能算作已有权益。 */
export function estimatedUses(id: CreationPlanId, scene: CreationScene, seconds: number) {
  const cost = creditsFor(scene, seconds);
  const plan = CREATION_PLANS.find((item) => item.id === id);
  if (!plan) throw new Error('无效的创作方案');
  return (plan.scenes as readonly CreationScene[]).includes(scene) ? Math.floor(plan.credits / cost) : null;
}
