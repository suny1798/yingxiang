import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { CreativeStudio } from '@/components/studio/creative-studio';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '创作空间 · 映想', description: '随时打开相机本地预览，点击映想画面的悬浮卡开启实时换装。' }); }
export default function StudioPage() { return <CreativeStudio />; }
