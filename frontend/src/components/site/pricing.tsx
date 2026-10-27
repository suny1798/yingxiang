'use client';

import { useI18n } from '@/components/preferences';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CREATION_PLANS, CREATION_SCENES, creditsFor, estimatedUses, money, type CreationScene, type CreationPlanId } from '@/lib/pricing';
import { useSandboxCheckout } from './payment-controls';
import { SiteShell, useSiteAccount } from './site-shell';
import s from './pricing.module.css';

const sceneKeys = Object.keys(CREATION_SCENES) as CreationScene[];

function PlanMark({ level }: { level: number }) {
  return <svg className={s.planMark} viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
    {level > 1 && <path d="M15 9V6a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3" />}
    {level > 0 && <path d="M9 15v-3a2 2 0 0 1 2-2h21a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-3" />}
    <rect x="4" y="16" width="24" height="24" rx="3" />
    <path d="M9 24v-3h3m8 0h3v3m0 8v3h-3m-8 0H9v-3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16" cy="28" r="2" />
  </svg>;
}

function FeatureCheck({ included = true }: { included?: boolean }) {
  return <svg className={s.featureIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={included ? 'm4 10 4 4 8-8' : 'M5 10h10'} />
  </svg>;
}

import { pricingFaqs as faqs } from '@/lib/public-pricing';

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
  const selectedPlan = CREATION_PLANS.find(plan => plan.id === selected)!;
  const cost = creditsFor(scene, seconds);
  const uses = estimatedUses(selected, scene, seconds);
  const changeScene = (value: CreationScene) => { setScene(value); setSeconds(15); };

  return <><main className={s.page}>
    <section className={s.intro}>
      <p className={s.eyebrow}>{t('套餐与积分')}</p>
      <h1>{t('选择适合你的创作套餐')}</h1>
      <p className={s.subtitle}>{t('三种创作模式共用套餐积分，积分长期有效，不自动续费。')}</p>
    </section>
    <section className={s.plans} aria-label={t('三档创作套餐')}>
      {CREATION_PLANS.map((plan, index) => <article key={plan.id} className={s.card} data-featured={plan.featured} data-selected={selected === plan.id} onClick={() => setSelected(plan.id)}>
        <div className={s.cardTop}>
          <div className={s.cardHeading}><PlanMark level={index} /><span className={s.planNote}>{t(plan.note)}</span></div>
          <h2><button type="button" className={s.planPick} aria-pressed={selected === plan.id} onClick={() => setSelected(plan.id)}>{t(plan.name)}<span className={s.selectionMark} aria-hidden="true">✓</span></button></h2>
          <p className={s.description}>{t(plan.description)}</p>
          <div className={s.price}><span>¥</span><strong>{plan.priceFen / 100}</strong><span>{t('/ 包')}</span></div>
          <p className={s.billing}>{t('一次性购买 · 积分长期有效')}</p>
          <button className={s.choose} type="button" onClick={event => { event.stopPropagation(); setSelected(plan.id); checkout.clearError(); setConfirming(plan.id); }}>{t(`选择${plan.name}`)}</button>
          <p className={s.renewal}>{t('不自动续费')}</p>
        </div>
        <div className={s.cardBenefits}>
          <div className={s.allowance}><p><strong>{plan.credits.toLocaleString(intlLocale)}</strong><span>{t('创作积分')}</span></p><small>{t('约 ¥')}{money(plan.priceFen / plan.credits)}{t(' / 积分')}</small></div>
          <ul className={s.features}>{sceneKeys.map(key => {
            const included = (plan.scenes as readonly CreationScene[]).includes(key);
            return <li key={key} data-included={included}><FeatureCheck included={included} /><span>{t(CREATION_SCENES[key].label)}</span><small>{t(included ? '包含' : '不包含')}</small></li>;
          })}</ul>
          <ul className={s.savedFeatures}>
            <li><FeatureCheck /><span>{t('生成视频自动保存到我的作品')}</span></li>
            <li><FeatureCheck /><span>{t('作品回放、镜像与下载')}</span></li>
          </ul>
        </div>
      </article>)}
    </section>
    <div className={s.status} role="note"><span className={s.statusTag}>{t('沙盒测试')}</span><p>{t('可测试付款与积分到账，不会真实扣款；实时编辑按独立测试额度开放，沙盒积分不解锁真实生成。')}</p></div>
    <section className={s.usage} aria-labelledby="usage-title">
      <div className={s.sectionHeading}><div><p className={s.eyebrow}>{t("用量估算")}</p><h2 id="usage-title">{t("当前套餐可创作次数")}</h2></div><p>{t("三种模式共用积分，可按不同功能组合使用。")}</p></div>
      <div className={s.calculator}><div className={s.sceneSwitch} role="group" aria-label={t("用量估算功能")}>{sceneKeys.map((key) => <button type="button" key={key} aria-pressed={scene === key} onClick={() => changeScene(key)}>{t(CREATION_SCENES[key].label)}</button>)}</div><div className={s.duration} role="group" aria-label={t("每次示例时长")}><span>{t("每次")}</span>{scenePolicy.examples.map((value) => <button type="button" key={value} aria-pressed={seconds === value} onClick={() => setSeconds(value)}>{t(value)} {t(" 秒")}</button>)}</div><p className={s.rate}>{creditsFor(scene, seconds)} {t(" 积分 / 次")}</p></div>
      <div className={s.estimates} aria-live="polite" aria-atomic="true">
        <div className={s.selectedAllowance}><span>{t('当前所选套餐')}</span><strong>{t(selectedPlan.name)}</strong><span>{selectedPlan.credits.toLocaleString(intlLocale)} {t('创作积分')}</span></div>
        <div className={s.estimateResult}>{uses === null ? <><strong className={s.unavailable}>{t('不包含实时编辑')}</strong><span>{t('可选创作包或进阶包')}</span></> : <><span>{t('预计可创作')}</span><p><strong>{uses.toLocaleString(intlLocale)}</strong><span>{t('次 × ')}{seconds}{t(' 秒 · ')}{t(scenePolicy.label)}</span></p><span>{t(`剩余 ${selectedPlan.credits - uses * cost} 积分`)}</span></>}</div>
      </div><p className={s.usageNote}>{t('按所选套餐的全部积分估算，切换套餐、功能或时长即可更新；不会扣除积分或启动生成。')}</p>
    </section>
    <section className={s.faq} aria-labelledby="faq-title"><div><p className={s.eyebrow}>{t("购买与使用")}</p><h2 id="faq-title">{t("常见问题")}</h2><Link href="/privacy" target="_blank" rel="noopener noreferrer">{t("隐私与使用说明 ↗")}</Link></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{t(question)}<span aria-hidden="true">＋</span></summary><p>{t(answer)}</p></details>)}</div></section>
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
    <p id={description} className={s.dialogIntro}>{t('确认套餐信息后，前往 Stripe 沙盒支付。')}</p>
    <dl className={s.orderDetails}>
      {username && <div><dt>{t('购买账号')}</dt><dd>{username}</dd></div>}
      <div><dt>{t('创作积分')}</dt><dd>{plan.credits.toLocaleString(intlLocale)} {t('积分')}</dd></div>
      <div><dt>{t('包含功能')}</dt><dd>{plan.scenes.map(scene => t(CREATION_SCENES[scene].label)).join(' / ')}</dd></div>
      <div><dt>{t('有效期')}</dt><dd>{t('长期有效，不自动续费')}</dd></div>
    </dl>
    <div className={s.orderTotal}><span>{t('应付金额')}</span><strong>¥{money(plan.priceFen)}<small>CNY</small></strong></div>
    <p className={s.sandboxNote}>{t('当前为 Stripe 沙盒测试，不会真实扣款；测试积分不能用于真实生成。')}{(plan.scenes as readonly CreationScene[]).includes('edit') && <span>{t('实时编辑按独立测试额度开放，沙盒积分不能用于真实生成。')}</span>}</p>
    {checkout.error && <p className={s.checkoutError} role="alert">{t(checkout.error)}</p>}
    <div className={s.dialogActions}><button type="button" disabled={checkout.busy} onClick={onClose}>{t('取消')}</button><button type="button" className={s.confirmPay} disabled={!checkout.ready || !checkout.enabled || checkout.busy} onClick={onConfirm}>{t(checkout.busy ? '正在前往 Stripe…' : !checkout.ready ? '正在读取支付状态…' : !checkout.enabled ? '购买暂未开放' : !username ? '登录后继续' : '确认并前往支付')}<span aria-hidden="true">↗</span></button></div>
  </dialog>;
}

export function PricingPage() { return <SiteShell active="pricing"><PricingContent /></SiteShell>; }
