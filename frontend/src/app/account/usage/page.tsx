import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '使用记录 · 映想', robots: { index: false, follow: false } }); }
export default function AccountUsagePage() { return <PersonalCenter section="usage" />; }
