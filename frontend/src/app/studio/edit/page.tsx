import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PromptStudio } from '@/components/studio/prompt-studio';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '实时编辑 · 映想', description: '打开摄像头并添加提示词，实时同步提示词组合并生成编辑画面。' }); }
export default function PromptStudioPage() { return <PromptStudio />; }
