import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { SiteShell } from '@/components/site/site-shell';
import { HelpCenter } from '@/components/site/help-center';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '帮助中心 · 映想', description: '查看实时换装、视频换装与实时编辑的操作步骤、素材要求、积分说明和常见问题。' }); }
export default function Page() { return <SiteShell active="help"><HelpCenter /></SiteShell>; }
