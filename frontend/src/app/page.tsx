import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { MarketingHome } from '@/components/site/home';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '映想 — 让想象，在眼前发生。', description: '映想实时画面创作：相机实时换装、视频换装，以及可组合提示词的实时编辑交互预览。让想象，在眼前发生。' }); }
export default function HomePage() { return <MarketingHome />; }
