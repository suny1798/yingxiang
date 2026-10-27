/** 旧版实时换装沙盒商品：仅为历史订单/既有SKU保留，不用于新的三档方案。 */
export const PRICING = [
  { seconds: 15, name: '15秒单次包', description: '15秒实时换装体验', prices: { 1: 690, 5: 2990, 10: 5690 } },
  { seconds: 30, name: '30秒单次包', description: '30秒实时换装体验', prices: { 1: 1290, 5: 5690, 10: 10900 } },
  { seconds: 60, name: '60秒单次包', description: '60秒实时换装体验', prices: { 1: 2390, 5: 10900, 10: 20900 } },
] as const;
export type Duration = typeof PRICING[number]['seconds'];
export type PackCount = 1 | 5 | 10;
export function quote(seconds: Duration, count: PackCount) {
  const plan = PRICING.find((item) => item.seconds === seconds);
  if (!plan || ![1, 5, 10].includes(count)) throw new Error('无效的体验方案');
  const totalFen = plan.prices[count];
  return { totalFen, unitFen: Math.round(totalFen / count), savedFen: plan.prices[1] * count - totalFen, totalSeconds: seconds * count };
}
