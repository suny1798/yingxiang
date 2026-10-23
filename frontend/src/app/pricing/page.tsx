import type { Metadata } from 'next';
import { PricingPage } from '@/components/site/pricing';
export const metadata: Metadata = { title: '价格方案 · 映想', description: '15秒、30秒、1分钟，按时长与次数选择体验方案。新用户可免费体验一次，付费暂未开放。' };
export default function Page() { return <PricingPage />; }
