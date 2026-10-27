export const homeScenes = [
  { name: '实时换装', tag: '实时相机', image: 'hero-live-v3.webp', href: '/studio', title: '在摄像头画面中实时换装', copy: '选择服装参考图并打开摄像头，确认云端处理后开始换装。可在同一次连接中切换服装，并对比相机原画与生成画面。', action: '开始实时换装', note: '新账号可免费体验一次15秒' },
  { name: '视频换装', tag: '视频文件', image: 'hero-video-male-v5.webp', href: '/studio/video', title: '为已有视频更换服装', copy: '上传1—15秒人物视频和服装参考图，系统自动移除音轨。生成完成后可预览、对比和下载。', action: '进入视频换装', note: '支持1—15秒人物视频 · 测试开放中' },
  { name: '实时编辑', tag: '提示词编辑', image: 'hero-prompt-v3.webp', href: '/studio/edit', title: '通过提示词组合编辑画面', copy: '打开摄像头并添加提示词，组合会实时同步到当前画面。生成视频与已同步提示词保存到我的作品。', action: '进入实时编辑', note: '提示词实时生成 · 作品自动保存' },
];

export const homeSteps = [
      ['01', '选择创作模式', '使用摄像头选择实时换装；已有视频选择视频换装；需要组合提示词时选择实时编辑。', '选择'],
      ['02', '准备素材', '打开本地相机，或上传视频与服装参考图。实时编辑可先打开相机，再添加或移除提示词。', '准备'],
      ['03', '确认并生成', '确认云端处理说明后开始；切换原画与生成画面或调整镜像。生成视频自动保存到我的作品。', '生成'],
    ] as const;

export const homeShowcaseScenes = [
  { image: '/assets/home/hero-live-refined-v7.webp', width: 2169, height: 725, alt: 'AI概念图：服装参考图与相机换装画面关联，非实际生成结果' },
  { image: '/assets/home/hero-video-refined-v7.webp', width: 2170, height: 725, alt: 'AI概念图：原视频、服装参考、换装预览与视频时间线，非实际生成结果' },
  { image: '/assets/home/hero-prompt-refined-v7.webp', width: 2172, height: 724, alt: 'AI概念图：组合提示词调整实时画面，非实际生成结果' },
  { image: '/assets/home/hero-workspace-refined-v7.webp', width: 2172, height: 724, alt: 'AI概念图：相机换装、视频换装、提示词编辑的三功能创作工作台' },
];

/** 首页滚轮节流与卸载回收，新旧框架共用原行为。 */
export function bindHeroWheel(hero: HTMLElement, content: HTMLElement, reducedMotion: boolean) {
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
}
