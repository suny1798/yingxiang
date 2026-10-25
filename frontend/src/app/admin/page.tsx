import { localizedMetadata } from '@/lib/server/localized-metadata';
import { AdminPage } from '@/components/site/admin-page';

export async function generateMetadata() {
  return localizedMetadata({ title: '管理后台 · 映想', robots: { index: false, follow: false } });
}

export default function Page() { return <AdminPage />; }
