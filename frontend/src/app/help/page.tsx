import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { SiteShell } from '@/components/site/site-shell';
import { HelpCenter } from '@/components/site/help-center';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '帮助中心 · 映想', description: '从第一次打开相机，到保存你的作品。查找映想三种创作方式的操作指南、素材要求、额度说明与常见问题。' }); }
export default function Page() { return <SiteShell active="help"><HelpCenter /></SiteShell>; }
