import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import { FeedbackPage } from '@/components/site/feedback-page';
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '问题反馈 · 映想' }); }
export default function Page() { return <FeedbackPage />; }
