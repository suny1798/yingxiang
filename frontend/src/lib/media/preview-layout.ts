/** 旧固定画框测量；React／Vue共用，沿用既有断点，不新增手机适配。 */
export function mountPreviewSurface(container:HTMLElement|null){
    const panel = container?.querySelector<HTMLElement>('[data-workspace-preview]');
    const viewport = panel?.querySelector<HTMLElement>('[data-preview-viewport]');
    if (!container || !panel || !viewport) return;
    const workspace = container.parentElement!;
    const shell = workspace.parentElement!;
    const sidebar = container.previousElementSibling as HTMLElement | null;
    let frame = 0;
    const measure = () => {
      const bounds = container.getBoundingClientRect();
      const css = getComputedStyle(panel);
      const horizontal = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
      // 三个模式使用同一框架，尺寸只取决于窗口，不能取决于页面内容或源视频。
      const chrome = ['--frame-heading', '--frame-toolbar', '--frame-controls', '--frame-details']
        .reduce((total, key) => total + parseFloat(css.getPropertyValue(key)), 0)
        + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)
        + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
      const compact = matchMedia('(max-width: 620px)').matches;
      // 621–1100px：预览独占一整行，素材面板下移，画面不再被左侧参考图挤窄。
      const cameraFirst = !compact && matchMedia('(max-width: 1100px)').matches;
      const stacked = compact || cameraFirst;
      const gap = parseFloat(getComputedStyle(workspace).columnGap) || 0;
      const leftWidth = !stacked && sidebar ? sidebar.getBoundingClientRect().width + gap : 0;
      // 从整行可用宽度计算，不能用加上居中留白后的槽宽，否则窗口变大时无法展开。
      const availableWidth = workspace.getBoundingClientRect().width - leftWidth;
      const ratio = 16 / 9;
      const width = cameraFirst
        ? Math.max(0, availableWidth - horizontal)
        : Math.max(0, Math.min(availableWidth - horizontal, (bounds.height - chrome) * ratio));
      const inset = stacked ? 0 : Math.max(0, (availableWidth - width - horizontal) / 2);
      const insetValue = `${inset}px`;
      if (shell.style.getPropertyValue('--workspace-inset') !== insetValue) shell.style.setProperty('--workspace-inset', insetValue);
      const values = { '--preview-panel-width': `${width + horizontal}px`, '--preview-panel-height': `${width / ratio + chrome}px` };
      for (const [key, value] of Object.entries(values)) if (container.style.getPropertyValue(key) !== value) container.style.setProperty(key, value);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observe = () => { resize.observe(container); resize.observe(workspace); if (sidebar) resize.observe(sidebar); schedule(); };
    observe(); measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); shell.style.removeProperty('--workspace-inset'); };
}
