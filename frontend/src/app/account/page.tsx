import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '个人中心 · 映想', robots: { index: false, follow: false } }); }
export default function AccountPage() { return <PersonalCenter />; }
