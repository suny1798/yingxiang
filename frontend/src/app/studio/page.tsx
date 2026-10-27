import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { CreativeStudio } from '@/components/studio/creative-studio';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '创作空间 · 映想', description: '打开摄像头并选择服装参考图，确认云端处理后开始实时换装。' }); }
export default function StudioPage() { return <CreativeStudio />; }
