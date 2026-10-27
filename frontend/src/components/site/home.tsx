'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { SiteShell } from './site-shell';
import { HomeShowcase } from './home-showcase';
import s from './site.module.css';
import h from './home.module.css';

const scenes = [
  { name: '实时换装', tag: '实时相机', image: 'hero-live-v3.webp', href: '/studio', title: '在摄像头画面中实时换装', copy: '选择服装参考图并打开摄像头，确认云端处理后开始换装。可在同一次连接中切换服装，并对比相机原画与生成画面。', action: '开始实时换装', note: '新账号可免费体验一次15秒' },
  { name: '视频换装', tag: '视频文件', image: 'hero-video-male-v5.webp', href: '/studio/video', title: '为已有视频更换服装', copy: '上传1—15秒人物视频和服装参考图，系统自动移除音轨。生成完成后可预览、对比和下载。', action: '进入视频换装', note: '支持1—15秒人物视频 · 测试开放中' },
  { name: '实时编辑', tag: '提示词编辑', image: 'hero-prompt-v3.webp', href: '/studio/edit', title: '通过提示词组合编辑画面', copy: '打开摄像头并添加提示词，组合会实时同步到当前画面。生成视频与已同步提示词保存到我的作品。', action: '进入实时编辑', note: '提示词实时生成 · 作品自动保存' },
];

export function MarketingHome() {
  const { t } = useI18n();
  return <SiteShell active="home"><main>
    <section className={h.hero} data-home-hero aria-labelledby="home-title">
      <HomeShowcase />
      <div className={`${s.container} ${h.heroInner}`}>
      <div className={s.heroCopy}><p className={s.eyebrow}><span className={s.liveDot} /> {t(" 映想 · 实时画面创作")}</p><h1 id="home-title">{t("让想象，")}<br /><span>{t("在眼前发生。")}</span></h1><p className={s.heroDescription}>{t("支持实时换装、视频换装与实时编辑。")}<br />{t("可处理相机画面、已有视频或提示词组合。")}</p><div className={s.heroActions}><Link href="/studio" prefetch={false} className={s.primary}>{t("开始实时换装 ")}<span aria-hidden="true">↗</span></Link><Link href="#creation-scenes" className={s.textLink}>{t("查看创作方式 ")}<span aria-hidden="true">↓</span></Link></div><p className={s.quiet}>{t("本地预览无需登录。新账号赠一次15秒实时换装。")}</p><nav className={h.sceneLinks} aria-label={t("首页创作入口")}><Link href="/studio" prefetch={false}>{t("实时换装")}</Link><Link href="/studio/video" prefetch={false}>{t("视频换装")}</Link><Link href="/studio/edit" prefetch={false}>{t("实时编辑")}</Link></nav></div>
      </div>
    </section>
    <div id="home-content" className={s.promiseStrip}><div className={s.container}><span>{t("实时相机换装")}</span><span>{t("已有视频换装")}</span><span>{t("提示词组合编辑")}</span><span>{t("云端处理前主动确认")}</span></div></div>
    <section id="creation-scenes" className={`${s.container} ${h.scenes}`} aria-labelledby="scenes-title">
      <div className={`${s.sectionHeading} ${h.scenesIntro}`}><div><p className={s.eyebrow}>{t("创作模式")}</p><h2 id="scenes-title">{t("按素材类型")}<br />{t("选择创作模式。")}</h2></div><p>{t("相机、已有视频与提示词分别对应三种模式。")}<br />{t("请根据当前素材选择。")}</p></div>
      <div className={h.sceneList}>{scenes.map(scene => <article key={scene.name} className={h.sceneFeature}>
        <div className={h.sceneArt}><img src={`/assets/home/${scene.image}`} alt="" width={1672} height={941} loading="lazy" /></div>
        <div className={h.sceneCopy}>
          <div className={h.sceneHeading}><h3>{t(scene.name)}</h3><span>{t(scene.tag)}</span></div>
          <h4>{t(scene.title)}</h4><p>{t(scene.copy)}</p>
          <div className={h.cardEnd}><span>{t(scene.note)}</span><Link href={scene.href} prefetch={false}>{t(scene.action)}<span aria-hidden="true">↗</span></Link></div>
        </div>
      </article>)}</div>
    </section>
    <section id="how-it-works" className={`${s.container} ${s.how} ${h.how}`}><div className={s.sectionHeading}><div><p className={s.eyebrow}>{t("使用流程")}</p><h2>{t("三步完成一次创作")}</h2></div><p>{t("选择模式并准备素材，确认云端处理后开始生成。")}</p></div><div className={s.steps}>{[
      ['01', '选择创作模式', '使用摄像头选择实时换装；已有视频选择视频换装；需要组合提示词时选择实时编辑。', '选择'],
      ['02', '准备素材', '打开本地相机，或上传视频与服装参考图。实时编辑可先打开相机，再添加或移除提示词。', '准备'],
      ['03', '确认并生成', '确认云端处理说明后开始；切换原画与生成画面或调整镜像。生成视频自动保存到我的作品。', '生成'],
    ].map(([number, title, copy, tag]) => <article key={number} className={s.step}><div className={s.stepTop}><span>{t(number)}</span><span>{t(tag)}</span></div><h3>{t(title)}</h3><p>{t(copy)}</p></article>)}</div></section>
    <section className={`${s.container} ${h.ownership}`} aria-labelledby="ownership-title"><div><p className={s.eyebrow}>{t("数据与权限")}</p><h2 id="ownership-title">{t("本地预览、云端处理与作品保存")}</h2></div><div className={h.principles}><p><strong>{t("先预览，再确认")}</strong><span>{t("本机相机预览不上传。确认开始后，才连接云端处理。")}</span></p><p><strong>{t("镜像与下载")}</strong><span>{t("换装支持镜像，下载方向与当前展示保持一致。")}</span></p><p><strong>{t("自动保存")}</strong><span>{t("生成视频与服装参考图自动保存到我的作品，不采集音频。")}</span></p><Link href="/privacy">{t("隐私与使用说明 ")}<span aria-hidden="true">↗</span></Link></div></section>
    <section className={`${s.container} ${s.finalCta}`}><div><p className={s.eyebrow}>{t("免费体验")}</p><h2>{t("新账号可免费体验一次实时换装")}</h2><p>{t("每次15秒，从生成画面开始播放后计时。三档积分方案长期有效，当前仅支持沙盒测试购买。")}</p></div><Link href="/studio" prefetch={false} className={s.primary}>{t("进入创作空间 ")}<span aria-hidden="true">↗</span></Link></section>
  </main></SiteShell>;
}
