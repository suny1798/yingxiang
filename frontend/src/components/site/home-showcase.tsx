'use client';

import { useI18n } from '@/components/preferences';
import { useEffect, useRef, useState } from 'react';
import s from './home-showcase.module.css';

const scenes = [
  { image: '/assets/home/hero-live-refined-v7.webp', width: 2169, height: 725, alt: 'AI概念图：服装参考图与相机换装画面关联，非实际生成结果' },
  { image: '/assets/home/hero-video-refined-v7.webp', width: 2170, height: 725, alt: 'AI概念图：原视频、服装参考、换装预览与视频时间线，非实际生成结果' },
  { image: '/assets/home/hero-prompt-refined-v7.webp', width: 2172, height: 724, alt: 'AI概念图：组合提示词调整实时画面，非实际生成结果' },
  { image: '/assets/home/hero-workspace-refined-v7.webp', width: 2172, height: 724, alt: 'AI概念图：相机换装、视频换装、提示词编辑的三功能创作工作台' },
];

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
    let locked = false, started = 0, lastWheel = 0;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      const elapsed = performance.now() - started;
      if (elapsed < 650 || (performance.now() - lastWheel < 180 && elapsed < 2200)) {
        releaseTimer = setTimeout(release, 180);
      } else locked = false;
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented || window.innerWidth < 900) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('textarea,input,select,[contenteditable="true"]')) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;
      if (locked) { event.preventDefault(); lastWheel = performance.now(); return; }
      const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
      if (event.deltaY < 0 || hero.getBoundingClientRect().bottom <= headerHeight + 2) return;
      event.preventDefault();
      locked = true; started = lastWheel = performance.now();
      const top = content.getBoundingClientRect().top + window.scrollY - headerHeight;
      window.scrollTo({ top, behavior: reducedMotion ? 'instant' : 'smooth' });
      releaseTimer = setTimeout(release, 180);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => { window.removeEventListener('wheel', wheel); clearTimeout(releaseTimer); };
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
