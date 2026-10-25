'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { SiteShell } from './site-shell';
import { HomeShowcase } from './home-showcase';
import s from './site.module.css';
import h from './home.module.css';

const scenes = [
  { name: '实时换装', tag: '相机里的此刻', image: 'hero-live-v3.webp', href: '/studio', title: '喜欢的衣服，现在试试看。', copy: '打开相机，放入服装参考图。在相机原画和映想画面之间切换，同一次连接里也可以继续换衣服。', action: '开始实时换装', note: '新账号可免费体验一次15秒' },
  { name: '视频换装', tag: '视频里的片刻', image: 'hero-video-v3.webp', href: '/studio/video', title: '已有的片段，也能换个搭配。', copy: '上传一段人物视频和服装参考图，生成后预览、对比，再保存喜欢的版本。视频中的音轨会自动移除。', action: '进入视频换装', note: '支持1—15秒人物视频 · 测试开放中' },
  { name: '实时编辑', tag: '一句话里的想法', image: 'hero-prompt-v3.webp', href: '/studio/edit', title: '一点点想法，慢慢叠加。', copy: '先打开相机，再写下想法。发送的提示词可以叠加、移除，先体验属于你的创作方式。', action: '预览实时编辑', note: '交互预览 · AI画面同步尚未接入' },
];

export function MarketingHome() {
  const { t } = useI18n();
  return <SiteShell active="home"><main>
    <section className={h.hero} data-home-hero aria-labelledby="home-title">
      <HomeShowcase />
      <div className={`${s.container} ${h.heroInner}`}>
      <div className={s.heroCopy}><p className={s.eyebrow}><span className={s.liveDot} /> {t(" 映想 · 实时画面创作")}</p><h1 id="home-title">{t("让想象，")}<br /><span>{t("在眼前发生。")}</span></h1><p className={s.heroDescription}>{t("相机里的此刻，视频里的片段，")}<br />{t("都可以是创作的起点。")}<br />{t("换一套穿搭，再试着写下一点新想法。")}</p><div className={s.heroActions}><Link href="/studio" prefetch={false} className={s.primary}>{t("免费体验实时换装 ")}<span aria-hidden="true">↗</span></Link><Link href="#creation-scenes" className={s.textLink}>{t("看看三种玩法 ")}<span aria-hidden="true">↓</span></Link></div><p className={s.quiet}>{t("本地预览无需登录。新账号赠一次15秒实时换装。")}</p><nav className={h.sceneLinks} aria-label={t("首页创作入口")}><Link href="/studio" prefetch={false}>{t("实时换装")}</Link><Link href="/studio/video" prefetch={false}>{t("视频换装")}</Link><Link href="/studio/edit" prefetch={false}>{t("实时编辑")}<span>{t("预览")}</span></Link></nav></div>
      </div>
    </section>
    <div id="home-content" className={s.promiseStrip}><div className={s.container}><span>{t("相机画面，边看边换")}</span><span>{t("已有视频，尝试新搭配")}</span><span>{t("提示词组合，先体验交互")}</span><span>{t("主动开启，由你决定")}</span></div></div>
    <section id="creation-scenes" className={`${s.container} ${h.scenes}`} aria-labelledby="scenes-title"><div className={s.sectionHeading}><div><p className={s.eyebrow}>{t("三种入口，同一份想象")}</p><h2 id="scenes-title">{t("你的灵感，")}<br />{t("不只一种打开方式。")}</h2></div><p>{t("从现在的自己，到已有的片段。")}<br />{t("选择适合这一刻的创作方式。")}</p></div><div className={h.sceneGrid}>{scenes.map((scene) => <article key={scene.name} className={h.sceneCard}><div className={h.sceneArt}><img src={`/assets/home/${scene.image}`} alt="" width={1672} height={941} loading="lazy" /></div><div className={h.sceneHeading}><h3>{t(scene.name)}</h3><span>{t(scene.tag)}</span></div><h4>{t(scene.title)}</h4><p>{t(scene.copy)}</p><div className={h.cardEnd}><span>{t(scene.note)}</span><Link href={scene.href} prefetch={false}>{t(scene.action)}<span aria-hidden="true">↗</span></Link></div></article>)}</div></section>
    <section id="how-it-works" className={`${s.container} ${s.how} ${h.how}`}><div className={s.sectionHeading}><div><p className={s.eyebrow}>{t("让创作轻一点")}</p><h2>{t("从一个念头，")}<br />{t("到一次尝试。")}</h2></div><p>{t("不必把流程想得太复杂。")}<br />{t("选择输入，准备好，再开始。")}</p></div><div className={s.steps}>{[
      ['01', '选一个创作入口', '想边看边换，选择实时换装；已有一段视频，选择视频换装；想组合提示词，进入实时编辑预览。', '选择'],
      ['02', '准备你的画面与想法', '打开本地相机，或上传视频与服装参考图。实时编辑可以先打开相机，再添加、移除提示词。', '准备'],
      ['03', '看一看，再决定', '换装时可切换原画与结果、调整镜像。视频结果可下载；实时换装需开始前开启保存。编辑目前仅预览交互。', '体验'],
    ].map(([number, title, copy, tag]) => <article key={number} className={s.step}><div className={s.stepTop}><span>{t(number)}</span><span>{t(tag)}</span></div><h3>{t(title)}</h3><p>{t(copy)}</p></article>)}</div></section>
    <section className={`${s.container} ${h.ownership}`} aria-labelledby="ownership-title"><div><p className={s.eyebrow}>{t("把选择留在你手里")}</p><h2 id="ownership-title">{t("你的画面，")}<span>{t("按你的想法来。")}</span></h2></div><div className={h.principles}><p><strong>{t("先预览，再开始")}</strong><span>{t("本机相机预览不上传。确认开始后，才连接云端处理。")}</span></p><p><strong>{t("方向自己调整")}</strong><span>{t("换装支持镜像，下载方向与当前展示保持一致。")}</span></p><p><strong>{t("想留下，再保存")}</strong><span>{t("不默认录制，不采集音频。生成结果仅供视觉参考。")}</span></p><Link href="/privacy">{t("隐私与使用说明 ")}<span aria-hidden="true">↗</span></Link></div></section>
    <section className={`${s.container} ${s.finalCta}`}><div><p className={s.eyebrow}>{t("第一份灵感，由映想请客")}</p><h2>{t("从你想尝试的那一刻开始。")}</h2><p>{t("新账号一次15秒实时换装体验，收到生成画面后开始倒计时。三档积分方案长期有效，目前支持沙盒测试购买。")}</p></div><Link href="/studio" prefetch={false} className={s.primary}>{t("进入创作空间 ")}<span aria-hidden="true">↗</span></Link></section>
  </main></SiteShell>;
}
