import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PricingPage } from '@/components/site/pricing';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '价格方案 · 映想', description: '轻享、创作与进阶三档积分方案，涵盖实时换装、视频换装与实时编辑。积分长期有效，支持沙盒测试购买；测试积分与真实生成权限独立，正式购买暂未开放。' }); }
export default function Page() { return <PricingPage />; }
