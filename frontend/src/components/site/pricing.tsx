'use client';

import { useI18n } from '@/components/preferences';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CREATION_PLANS, CREATION_SCENES, creditsFor, estimatedUses, money, type CreationScene, type CreationPlanId } from '@/lib/pricing';
import { useSandboxCheckout } from './payment-controls';
import { SiteShell, useSiteAccount } from './site-shell';
import s from './pricing.module.css';

const sceneKeys = Object.keys(CREATION_SCENES) as CreationScene[];
const faqs = [
  ['积分怎么使用？', '三种功能按各自费率共用同一份套餐积分。拟定费率：实时换装、实时编辑每秒1积分，视频换装每秒2积分；不足1积分向上取整。页面次数是把整包积分用于单一功能的估算，不能同时获得每一项所示次数。'],
  ['轻享包和另外两档有什么区别？', '轻享包仅包含实时换装和视频换装，不包含实时编辑；创作包和进阶包包含三种功能。进阶包的积分更多，每积分的价格更低。三档均不承诺无限生成或额外清晰度。'],
  ['现在可以购买、使用全部功能吗？', '目前已开放 Stripe 沙盒测试付款与测试积分发放，正式购买与真实积分扣费尚未开放。实时编辑仍为交互预览，画面同步待接入；套餐中的实时编辑权益将在功能上线后提供。当前测试账号权限和既有体验次数保持原有规则。'],
  ['有效期和续费怎么安排？', '一次性购买，积分长期有效，不设到期日，不自动续费、不默认加购。沙盒积分仅用于支付流程测试；退款与失败补偿规则将在正式购买开放前明确。'],
];

function PricingContent() {
  const { t, intlLocale } = useI18n();
  const [selected, setSelected] = useState<CreationPlanId>('creator');
  const [scene, setScene] = useState<CreationScene>('tryon');
  const [seconds, setSeconds] = useState(15);
  const [confirming, setConfirming] = useState<CreationPlanId | null>(null);
  const checkout = useSandboxCheckout();
  const { account } = useSiteAccount();
  const owner = useRef(account?.user?.id);
  useEffect(() => {
    if (owner.current !== account?.user?.id) setConfirming(null);
    owner.current = account?.user?.id;
  }, [account?.user?.id]);
  const purchasePlan = CREATION_PLANS.find(plan => plan.id === confirming);
  const scenePolicy = CREATION_SCENES[scene];
  const changeScene = (value: CreationScene) => { setScene(value); setSeconds(15); };

  return <><main className={s.page}>
    <section className={s.intro}><div><p className={s.eyebrow}>{t("映想 · 创作方案")}</p><h1>{t("为你的想象，")}<span>{t("留一点余量。")}</span></h1><p className={s.subtitle}>{t("一份积分，按需用于不同创作方式。积分不过期，不自动续费。")}</p></div><Link href="/studio" prefetch={false} className={s.freeLink}>{t("新用户先体验 15 秒 ")}<span aria-hidden="true">↗</span></Link></section>
    <div className={s.status} role="note"><span className={s.statusTag}>{t("沙盒测试")}</span><p>{t("可测试付款与积分到账，不会真实扣款；实时编辑仍为交互预览，将在画面同步上线后提供套餐权益。")}</p></div>
    <section className={s.plans} aria-label={t("三档创作套餐")}>{CREATION_PLANS.map((plan) => <article key={plan.id} className={s.card} data-selected={selected === plan.id} onClick={() => setSelected(plan.id)}>
      <div className={s.cardHeading}><h2><button type="button" className={s.planPick} aria-pressed={selected === plan.id} onClick={() => setSelected(plan.id)}>{t(plan.name)}{selected === plan.id && <span aria-hidden="true">✓</span>}</button></h2><span>{t(plan.note)}</span></div><p className={s.description}>{t(plan.description)}</p>
      <div className={s.price}><span>¥</span><strong>{plan.priceFen / 100}</strong><span>{t("/ 包")}</span></div>
      <div className={s.allowance}><strong>{t(plan.credits.toLocaleString(intlLocale))}</strong><span>{t("创作积分")}</span><small>{t("约 ¥")}{t(money(plan.priceFen / plan.credits))} {t(" / 积分")}</small></div>
      <ul className={s.features}>{sceneKeys.map((key) => {
        const included = (plan.scenes as readonly CreationScene[]).includes(key);
        return <li key={key} data-included={included}><span className={s.featureIcon} aria-hidden="true">{t(included ? '✓' : '—')}</span><span>{t(CREATION_SCENES[key].label)}</span><span>{t(included ? key === 'edit' ? '开放后可用' : '包含' : '不包含')}</span></li>;
      })}</ul>
      <button className={s.choose} type="button" onClick={event => { event.stopPropagation(); setSelected(plan.id); checkout.clearError(); setConfirming(plan.id); }}>{t('点击购买')}<span aria-hidden="true">↗</span></button>
    </article>)}</section>
    <section className={s.usage} aria-labelledby="usage-title">
      <div className={s.sectionHeading}><div><p className={s.eyebrow}>{t("让额度更好理解")}</p><h2 id="usage-title">{t("这些积分，能创作多少次？")}</h2></div><p>{t("三种功能共用积分，可自由搭配使用。")}</p></div>
      <div className={s.calculator}><div className={s.sceneSwitch} role="group" aria-label={t("用量估算功能")}>{sceneKeys.map((key) => <button type="button" key={key} aria-pressed={scene === key} onClick={() => changeScene(key)}>{t(CREATION_SCENES[key].label)}</button>)}</div><div className={s.duration} role="group" aria-label={t("每次示例时长")}><span>{t("每次")}</span>{scenePolicy.examples.map((value) => <button type="button" key={value} aria-pressed={seconds === value} onClick={() => setSeconds(value)}>{t(value)} {t(" 秒")}</button>)}</div><p className={s.rate}>{creditsFor(scene, seconds)} {t(" 积分 / 次")}{scene === 'edit' && t(' · 功能上线后适用')}</p></div>
      <div className={s.estimates} aria-live="polite">{CREATION_PLANS.map((plan) => {
        const uses = estimatedUses(plan.id, scene, seconds);
        return <div key={plan.id}><span>{t(plan.name)}</span>{uses === null ? <strong className={s.unavailable}>{t("不包含实时编辑")}</strong> : <p><strong>{uses}</strong><span>{t("次 × ")}{seconds} {t(" 秒")}</span></p>}<small>{t(uses === null ? '可选创作包或进阶包' : `全部 ${plan.credits} 积分用于${scenePolicy.label}`)}</small></div>;
      })}</div><p className={s.usageNote}>{t("以上为单功能用量示例，不是三份独立额度；本页估算不会扣除积分或启动生成。")}</p>
    </section>
    <section className={s.faq} aria-labelledby="faq-title"><div><p className={s.eyebrow}>{t("开始之前")}</p><h2 id="faq-title">{t("把规则说清楚。")}</h2><Link href="/privacy" target="_blank" rel="noopener noreferrer">{t("隐私与使用说明 ↗")}</Link></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{t(question)}<span aria-hidden="true">＋</span></summary><p>{t(answer)}</p></details>)}</div></section>
  </main>{purchasePlan && <PurchaseConfirmation plan={purchasePlan} checkout={checkout} username={account?.user?.username ?? null} onClose={() => { if (!checkout.busy) setConfirming(null); }} onConfirm={() => { if (!account?.user) setConfirming(null); void checkout.buy(`credits-v1-${purchasePlan.id}`); }} />}</>;
}

function PurchaseConfirmation({ plan, checkout, username, onClose, onConfirm }: {
  plan: typeof CREATION_PLANS[number]; checkout: ReturnType<typeof useSandboxCheckout>; username: string | null; onClose: () => void; onConfirm: () => void;
}) {
  const { t, intlLocale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), title = useId(), description = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={s.confirmDialog} aria-labelledby={title} aria-describedby={description} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <div className={s.dialogTop}><span>{t('确认订单')}</span><button type="button" autoFocus disabled={checkout.busy} onClick={onClose} aria-label={t('关闭订单确认')}>×</button></div>
    <h2 id={title}>{t(plan.name)}<span>{t('一次性购买')}</span></h2>
    <p id={description} className={s.dialogIntro}>{t('核对这次的创作方案，确认后前往 Stripe 支付。')}</p>
    <dl className={s.orderDetails}>
      {username && <div><dt>{t('购买账号')}</dt><dd>{username}</dd></div>}
      <div><dt>{t('创作积分')}</dt><dd>{plan.credits.toLocaleString(intlLocale)} {t('积分')}</dd></div>
      <div><dt>{t('包含功能')}</dt><dd>{plan.scenes.map(scene => t(CREATION_SCENES[scene].label)).join(' / ')}</dd></div>
      <div><dt>{t('有效期')}</dt><dd>{t('长期有效，不自动续费')}</dd></div>
    </dl>
    <div className={s.orderTotal}><span>{t('应付金额')}</span><strong>¥{money(plan.priceFen)}<small>CNY</small></strong></div>
    <p className={s.sandboxNote}>{t('当前为 Stripe 沙盒测试，不会真实扣款；测试积分不能用于真实生成。')}{(plan.scenes as readonly CreationScene[]).includes('edit') && <span>{t('实时编辑仍为交互预览，开放后提供对应权益。')}</span>}</p>
    {checkout.error && <p className={s.checkoutError} role="alert">{t(checkout.error)}</p>}
    <div className={s.dialogActions}><button type="button" disabled={checkout.busy} onClick={onClose}>{t('再想一想')}</button><button type="button" className={s.confirmPay} disabled={!checkout.ready || !checkout.enabled || checkout.busy} onClick={onConfirm}>{t(checkout.busy ? '正在前往 Stripe…' : !checkout.ready ? '正在读取支付状态…' : !checkout.enabled ? '购买暂未开放' : !username ? '登录后继续' : '确认并前往支付')}<span aria-hidden="true">↗</span></button></div>
  </dialog>;
}

export function PricingPage() { return <SiteShell active="pricing"><PricingContent /></SiteShell>; }
