'use client';

import { useI18n } from '@/components/preferences';
import { useEffect, useRef, useState } from 'react';
import s from './home-showcase.module.css';

import { homeShowcaseScenes as scenes, bindHeroWheel } from '@/lib/public-home';

export function HomeShowcase() {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(motion.matches);
    const syncVisibility = () => setHidden(document.hidden);
    syncMotion(); syncVisibility();
    motion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => { motion.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility); };
  }, []);
  useEffect(() => {
    if (hidden || reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % scenes.length), 6000);
    return () => window.clearTimeout(timer);
  }, [hidden, reducedMotion, index]);
  useEffect(() => {
    const hero = root.current?.closest<HTMLElement>('[data-home-hero]');
    const content = document.getElementById('home-content');
    if (!hero || !content) return;
    return bindHeroWheel(hero, content, reducedMotion);
  }, [reducedMotion]);
  const choose = (direction: number) => setIndex((value) => (value + direction + scenes.length) % scenes.length);
  return <section ref={root} className={s.showcase} aria-roledescription="轮播" aria-label={t("映想写实创作背景")}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); choose(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); choose(1); } }}>
    <div className={s.frame}>
      {scenes.map((item, value) => <div key={item.image} role="group" aria-roledescription="幻灯片" aria-label={t(`${value + 1} / ${scenes.length}`)} aria-hidden={value !== index} className={s.slide} data-active={value === index}>
        <img src={item.image} alt={t(item.alt)} width={item.width} height={item.height} loading="eager" decoding="async" />
      </div>)}
    </div>
    <div className={s.arrows}><button type="button" aria-label={t("上一张背景")} onClick={() => choose(-1)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7" /></svg></button><button type="button" aria-label={t("下一张背景")} onClick={() => choose(1)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" /></svg></button></div>
  </section>;
}
