import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PrivacyContent } from '@/components/site/privacy-content';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '隐私与使用说明 · 映想', description: '了解相机预览、云端处理、视频保存与历史记录。' }); }
export default function PrivacyPage() { return <PrivacyContent />; }
