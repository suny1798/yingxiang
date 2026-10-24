import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/site/placeholder-page';
export const metadata: Metadata = { title: '问题反馈 · 映想' };
export default function Page() { return <PlaceholderPage title="问题反馈" active="help" description="反馈表单正在准备，完成后会在这里更新。" />; }
