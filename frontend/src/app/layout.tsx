import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '映想 — 让想象，在眼前发生。',
  description: '映想实时画面创作。上传上衣参考图，开启实时换装。',
  icons: { icon: '/assets/mark.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
