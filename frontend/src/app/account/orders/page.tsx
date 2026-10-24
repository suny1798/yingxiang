import type { Metadata } from 'next';
import { PersonalCenter } from '@/components/site/account-page';
export const metadata: Metadata = { title: '我的订单 · 映想', robots: { index: false, follow: false } };
export default function AccountOrdersPage() { return <PersonalCenter section="orders" />; }
