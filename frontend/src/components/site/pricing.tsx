'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PRICING, quote, money, type Duration, type PackCount } from '@/lib/pricing';
import { durationLabel } from '@/lib/studio/policy';
import { SiteShell } from './site-shell';
import s from './site.module.css';

export function PricingPage() {
  const [seconds, setSeconds] = useState<Duration>(30);
  const [count, setCount] = useState<PackCount>(5);
  const value = quote(seconds, count);
  return <SiteShell active="pricing"><main className={s.container}>
    <section className={s.pageIntro}><p className={s.eyebrow}>按时长，按次数，把选择留给你</p><h1>为每一次想象，<br /><span>留出刚好的时间。</span></h1><p>先免费试一次，再选择适合自己的体验包。<br />一次性购买，无月费，不自动续费。</p></section>
    <div className={s.notice} role="note"><span className={s.liveDot} /><div><strong>以下为拟定价格，付费购买暂未开放。</strong><p>目前可使用每个新账号一次的15秒免费体验。30秒及更长体验将在验证完成、支付上线后开放。</p></div></div>
    <section className={s.freeOffer} aria-labelledby="free-title"><div className={s.freeStamp}>第一份<br />灵感</div><div><p className={s.eyebrow}>新用户礼遇</p><h2 id="free-title">15秒，先看一看。</h2><p>每个账号一次免费体验，无需绑定支付方式。</p></div><strong>¥0 <small>/ 1次</small></strong><Link href="/studio" prefetch={false} className={s.primary}>先免费体验 <span aria-hidden="true">↗</span></Link></section>
    <section aria-label="单次时长方案" className={s.planGrid}>{PRICING.map((plan) => <article key={plan.seconds} className={`${s.planCard} ${plan.seconds === 30 ? s.planFeatured : ''}`}>
      <div className={s.planTop}><span>{plan.name}</span>{plan.seconds === 30 && <span>从容之选</span>}</div><h2>{plan.seconds === 60 ? 1 : plan.seconds}<small>{plan.seconds === 60 ? '分钟' : '秒'} / 次</small></h2><p>{plan.description}</p><div className={s.planPrice}>¥{money(plan.prices[1])}<span>/ 单次</span></div><button type="button" onClick={() => { setSeconds(plan.seconds); document.getElementById('build-plan')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }} className={s.outline}>搭配体验次数 <span aria-hidden="true">↓</span></button><span className={s.planStatus}>拟定方案 · 付费暂未开放</span>
    </article>)}</section>
    <section id="build-plan" className={s.builder} aria-labelledby="builder-title"><div><p className={s.eyebrow}>多次探索，多一点余地</p><h2 id="builder-title">搭配你的体验包。</h2><p className={s.bodyCopy}>每次时长固定，分次使用。<br />同一连接里换衣服，不额外计次数。</p><fieldset><legend>每次体验时长</legend><div className={s.choices}>{PRICING.map((plan) => <button type="button" key={plan.seconds} aria-pressed={seconds === plan.seconds} onClick={() => setSeconds(plan.seconds)}>{durationLabel(plan.seconds)}</button>)}</div></fieldset><fieldset><legend>体验次数</legend><div className={s.choices}>{([1, 5, 10] as const).map((n) => <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>{n}次{n > 1 && <small>体验包</small>}</button>)}</div></fieldset></div>
      <div className={s.quoteCard} aria-live="polite" aria-atomic="true"><div className={s.quoteTop}><span>你的体验方案</span><span>拟定价格</span></div><h3>{durationLabel(seconds)} <span>×</span> {count}次</h3><div className={s.quotePrice}>¥{money(value.totalFen)}</div><p>约 ¥{money(value.unitFen)} / 次 · 总计{value.totalSeconds}秒体验窗口</p><div className={s.quoteSaving}>{value.savedFen > 0 ? `比单次购买合计节省 ¥${money(value.savedFen)}` : '先从一次尝试开始'}</div><button type="button" disabled className={s.disabledPurchase}>购买暂未开放</button><Link href="/studio" prefetch={false} className={s.textLink}>先用一次免费体验 <span aria-hidden="true">↗</span></Link><p className={s.quoteFootnote}>这里仅计算方案，不创建订单或扣款。购买、有效期及退款规则将在付费开放前公布。</p></div>
    </section>
    <section className={s.faq} aria-labelledby="pricing-faq"><div><p className={s.eyebrow}>把规则说清楚</p><h2 id="pricing-faq">开始之前，<br />你可能想知道。</h2></div><div>{[
      ['这里的“秒”指什么？', '指每次体验的最长连接窗口，包含连接准备时间，实际看到生成画面的时长可能更短。这是实时换装体验，不是购买同等长度的下载视频。'],
      ['次数怎么计算？换衣服也算一次吗？', '方案按“每次时长 × 开启次数”设计。同一连接中更换参考图不额外算一次；结束后再次开启是新的一次。付费包目前尚不能购买或使用。'],
      ['免费体验什么时候占用？', '登录、选图、阅读说明和相机授权失败都不占用。服务端向模型申请连接凭据前会占用一次；已申请而结果不确定时保留待核查，不自动再次连接。'],
      ['失败或提前结束会退款吗？', '当前没有真实付费订单。付费开放前会公布未出画核查、失败补偿及提前结束的规则，不能仅凭客户端上报自动认定模型未产生费用。'],
      ['会自动续费吗？', '计划采用一次性体验包，不做自动续费，也不默认追加连接。当前无需绑定支付方式。'],
    ].map(([title, copy]) => <details key={title}><summary>{title}<span aria-hidden="true">+</span></summary><p>{copy}</p></details>)}</div></section>
  </main></SiteShell>;
}
