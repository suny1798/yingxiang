import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/site/placeholder-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '帮助中心 · 映想' }); }
export default function Page() { return <PlaceholderPage title="帮助中心" active="help" feedback description="常见问题与使用说明正在整理，完成后会在这里更新。" />; }
