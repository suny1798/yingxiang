import type { Metadata } from 'next';
import { PromptStudio } from '@/components/studio/prompt-studio';
export const metadata: Metadata = { title: '实时编辑 · 映想', description: '用提示词探索实时画面的变化，先在本地预览，再主动开启云端编辑。' };
export default function PromptStudioPage() { return <PromptStudio />; }
