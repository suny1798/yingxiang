import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export const metadata: Metadata = { title: '个人中心 · 映想', robots: { index: false, follow: false } };
export default function AccountPage() { return <PersonalCenter />; }
