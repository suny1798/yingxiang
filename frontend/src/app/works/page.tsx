import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { WorksPage } from '@/components/site/works-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '我的作品 · 映想' }); }
export default function Page() { return <WorksPage />; }
