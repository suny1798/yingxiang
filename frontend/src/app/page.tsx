import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { MarketingHome } from '@/components/site/home';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '映想 — 让想象，在眼前发生。', description: '映想提供实时换装、视频换装与提示词实时编辑。可使用摄像头、已有视频或提示词完成画面创作，生成内容自动保存。' }); }
export default function HomePage() { return <MarketingHome />; }
