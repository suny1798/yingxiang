import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { TermsPage } from '@/components/site/terms-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '用户协议 · 映想' }); }
export default function Page() { return <TermsPage />; }
