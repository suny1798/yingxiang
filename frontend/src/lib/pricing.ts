/** 展示用拟定价目，单位为人民币分；支付及付费长时体验尚未开放。 */
export const PRICING = [
  { seconds: 15, name: '灵感一试', description: '看一件服装的第一眼感觉', prices: { 1: 690, 5: 2990, 10: 5690 } },
  { seconds: 30, name: '从容看看', description: '给搭配多一点观察时间', prices: { 1: 1290, 5: 5690, 10: 10900 } },
  { seconds: 60, name: '多面探索', description: '留出转身与换图的空间', prices: { 1: 2390, 5: 10900, 10: 20900 } },
] as const;
export type Duration = typeof PRICING[number]['seconds'];
export type PackCount = 1 | 5 | 10;
export function quote(seconds: Duration, count: PackCount) {
  const plan = PRICING.find((item) => item.seconds === seconds);
  if (!plan || ![1, 5, 10].includes(count)) throw new Error('无效的体验方案');
  const totalFen = plan.prices[count];
  return { totalFen, unitFen: Math.round(totalFen / count), savedFen: plan.prices[1] * count - totalFen, totalSeconds: seconds * count };
}
export const money = (fen: number) => (fen / 100).toFixed(2);
