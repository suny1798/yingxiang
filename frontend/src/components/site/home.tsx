import Link from 'next/link';
import { SiteShell } from './site-shell';
import s from './site.module.css';

function Shirt({ color = '#793d50' }: { color?: string }) {
  return <svg viewBox="0 0 220 240" fill="none" aria-hidden="true"><path d="m69 40 24-10h34l24 10 45 33-26 42-22-13 8 112H64l8-112-22 13-26-42z" fill={color} /><path d="m93 30 17 27 17-27m-17 27v157M72 102l5-42m71 42-5-42" stroke="#fffefa" strokeOpacity=".45" strokeWidth="2" /><path d="m93 30 17 27-20 9-12-30m49-6-17 27 20 9 12-30" fill="#fffefa" fillOpacity=".15" />{[83,110,137,164,191].map((y) => <circle key={y} cx="115" cy={y} r="1.5" fill="#fffefa" fillOpacity=".7" />)}</svg>;
}
export function MarketingHome() {
  return <SiteShell active="home"><main>
    <section className={`${s.container} ${s.hero}`} aria-labelledby="home-title"><div className={s.heroCopy}><p className={s.eyebrow}><span className={s.liveDot} /> 映想 · 实时画面创作</p><h1 id="home-title">让想象，<br /><span>在眼前发生。</span></h1><p className={s.heroDescription}>喜欢的服装，不必只停在商品图里。<br />选一张参考图，在自己的实时画面里，<br className={s.desktopBreak} />看看另一种穿着的可能。</p><div className={s.heroActions}><Link href="/studio" prefetch={false} className={s.primary}>免费体验一次 <span aria-hidden="true">↗</span></Link><Link href="/pricing" className={s.textLink}>看看价格 <span aria-hidden="true">→</span></Link></div><p className={s.quiet}>先选图，生成前再登录。无需绑定支付方式。</p><div className={s.heroIndex}><span>当前开放</span><strong>实时换装</strong><span className={s.indexLine} /><span>单人 · 穿搭</span></div></div>
      <div className={s.heroVisual} aria-label="实时换装创作流程插画"><div className={s.visualPaper}><span className={s.visualTop}>一件衣服，另一种可能。</span><span className={`${s.visualStar} star-hover-spin`} aria-hidden="true">✳</span><img className={s.heroMannequin} src="/assets/fitting-room.svg" alt="穿着衬衫的裁衣人台插画，非真实生成结果" /><span className={s.visualVertical}>给眼前的世界 · 一点新想象</span><div className={s.visualBottom}><span className={s.liveDot} />画面，从这里开始。</div></div><div className={s.referenceCard}><span>你选择的参考图</span><Shirt /><div><i /><span>莓果红衬衫</span><span aria-hidden="true">↗</span></div></div><div className={s.swatchStrip} aria-hidden="true"><i /><i /><i /><span>让风格，多一种。</span></div><p className={s.visualCaption}>创作流程示意 · 非真实生成结果</p></div>
    </section>
    <div className={s.promiseStrip}><div className={s.container}><span>参考图 + 相机画面</span><span>同一连接，继续换图</span><span>原画与生成画面对比</span><span>随时结束，由你决定</span></div></div>
    <section id="how-it-works" className={`${s.container} ${s.how}`}><div className={s.sectionHeading}><div><p className={s.eyebrow}>从一件服装开始</p><h2>灵感到眼前，<br />只需要几步。</h2></div><p>先把想试的衣服准备好，<br />剩下的，在创作空间完成。</p></div><div className={s.steps}>{[
      ['01', '选一张服装图', '上传有使用权的清晰正面商品图。图片在本地处理，选图时不发送给模型。', '参考图'],
      ['02', '先打开相机看看', '无需登录即可本机预览。切到映想画面后，确认并点击开始，再连接云端换装。', '相机'],
      ['03', '看见，换一件，再对比', '生成画面播放后，可以换参考图、查看相机原画，或直接结束。不默认录制。', '画面'],
    ].map(([number, title, copy, tag]) => <article key={number} className={s.step}><div className={s.stepTop}><span>{number}</span><span>{tag}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className={`${s.container} ${s.possibilities}`}><div className={s.possibilityArt} aria-hidden="true"><Shirt color="#68725f" /><span>从「想试试」<br />到「看一看」。</span><i className="star-hover-spin">✳</i></div><div><p className={s.eyebrow}>先探索穿着的可能</p><h2>给搭配一个<br />新的观察角度。</h2><p className={s.bodyCopy}>一张商品图，一件正在犹豫的衬衫，一种平时少穿的颜色。映想让这些念头，进入自己的实时画面。</p><ul className={s.featureList}><li><strong>边看边换</strong><span>同一次体验里，更换有效的服装参考图。</span></li><li><strong>保留自己的视角</strong><span>在 AI 生成画面与相机原画之间切换。</span></li><li><strong>你的画面，由你决定</strong><span>主动开启，随时结束。不采集音频。</span></li></ul><p className={s.quiet}>生成结果仅供视觉参考，不提供尺码或合身保证。</p></div></section>
    <section className={s.future}><div className={s.container}><p className={s.eyebrow}>想象，留一点给以后</p><h2>今天，从穿着开始。<br /><span>未来，还可以是更多。</span></h2><div><span>穿着创作</span><span>室内背景</span><span>宠物与摆件</span></div><p>提示词编辑与这些新场景仍在规划中，当前提供实时换装体验。</p></div></section>
    <section className={`${s.container} ${s.finalCta}`}><div><p className={s.eyebrow}>第一份灵感，由映想请客</p><h2>选一件你想试的服装吧。</h2><p>本地相机预览不限次数。每个新账号一次云端免费体验，生成画面开始播放后倒计时，最多15秒；连接等待不扣体验秒数，供应商中断可能提前结束。</p></div><Link href="/studio" prefetch={false} className={s.primary}>进入创作空间 <span aria-hidden="true">↗</span></Link></section>
  </main></SiteShell>;
}
