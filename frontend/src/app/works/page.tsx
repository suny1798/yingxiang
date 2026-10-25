import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/site/placeholder-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '我的作品 · 映想' }); }
export default function Page() { return <PlaceholderPage title="我的作品" active="works" description="作品记录与下载入口正在准备，完成后会在这里更新。" />; }
