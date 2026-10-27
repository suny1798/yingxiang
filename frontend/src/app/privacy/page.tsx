import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PrivacyContent } from '@/components/site/privacy-content';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '隐私与使用说明 · 映想', description: '说明相机预览、云端处理、作品保存、截图与下载规则。' }); }
export default function PrivacyPage() { return <PrivacyContent />; }
