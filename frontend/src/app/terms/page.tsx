import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/site/placeholder-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '用户协议 · 映想' }); }
export default function Page() { return <PlaceholderPage title="用户协议" active="terms" description="用户协议文本正在整理，完成后会在这里更新。" />; }
