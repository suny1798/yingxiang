import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export const metadata: Metadata = { title: '账号信息 · 映想', robots: { index: false, follow: false } };
export default function AccountSecurityPage() { return <PersonalCenter section="security" />; }
