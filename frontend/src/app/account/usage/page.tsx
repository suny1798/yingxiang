import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export const metadata: Metadata = { title: '使用记录 · 映想', robots: { index: false, follow: false } };
export default function AccountUsagePage() { return <PersonalCenter section="usage" />; }
