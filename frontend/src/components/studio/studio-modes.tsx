import Link from 'next/link';
import s from './studio-modes.module.css';

export function StudioModes({ active }: { active: 'realtime' | 'video' | 'prompt' }) {
  return <nav className={s.modes} aria-label="创作模式">
    <Link prefetch={false} href="/studio" aria-current={active === 'realtime' ? 'page' : undefined}><span aria-hidden="true">◉</span>实时换装</Link>
    <Link prefetch={false} href="/studio/video" aria-current={active === 'video' ? 'page' : undefined}><span aria-hidden="true">▷</span>视频换装</Link>
    <Link prefetch={false} href="/studio/edit" aria-current={active === 'prompt' ? 'page' : undefined}><span aria-hidden="true">✳</span>实时编辑</Link>
  </nav>;
}
