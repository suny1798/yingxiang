'use client';

import Link from 'next/link';
import { useI18n } from '@/components/preferences';
import { SiteShell } from './site-shell';
import s from './support.module.css';

type Copy = readonly [string, string];
const sections: { id: string; title: Copy; paragraphs: Copy[] }[] = [
  { id: 'scope', title: ['服务范围与当前阶段', 'Service scope & current stage'], paragraphs: [
    ['映想是实时画面创作工具，提供实时换装、视频换装入口及实时编辑交互预览。具体可用功能以页面状态、账号权益及实际开放范围为准；功能入口不代表所有账号均可生成。', 'Yingxiang is a visual creation tool with live try-on, video try-on, and an interactive preview of live editing. Availability depends on the displayed status, your entitlements, and current access limits. A feature entry does not mean generation is available to every account.'],
    ['实时编辑目前支持本页提示词的添加、叠加与删除，尚未同步生成模型；首页概念背景及演示不构成生成效果或未来功能的承诺。', 'Live editing currently lets you add, combine, and remove prompts in the interface; it does not synchronize them with a generation model. Homepage concept images and demonstrations do not promise particular results or future features.'],
    ['本页为当前内测版本的使用约定，更新于 2026 年 10 月 25 日。正式交易尚未开放；经营主体、有效联系渠道和正式售后规则仍需在商业上线前公示。浏览本页不等于已完成协议签署或云端处理授权。', 'These terms describe the current test version, updated on October 25, 2026. Live commercial payments are not available. The operating entity, working contact channel, and commercial after-sales rules must be published before commercial launch. Viewing this page does not sign an agreement or authorize cloud processing.'],
  ] },
  { id: 'account', title: ['账号与使用资格', 'Accounts & access'], paragraphs: [
    ['你可以先体验本机相机和素材预览。云端生成需要登录、可用权益和已开放的服务。请妥善保管账号，不分享密码、验证码或访问令牌；发现异常使用时停止操作，并联系向你提供体验资格的项目维护者。', 'You may preview your camera and materials locally first. Cloud generation requires sign-in, available entitlements, and an enabled service. Keep your account secure and never share passwords, verification codes, or access tokens. If you notice suspicious activity, stop and contact the project maintainer who invited you.'],
    ['不要冒用他人身份、买卖账号、绕过额度或预算限制，也不要利用自动化反复提交任务。当前未提供自助找回密码、账户注销或账户数据删除入口；相关请求可先通过反馈报告整理后交给项目维护者核实处理。', 'Do not impersonate others, trade accounts, bypass quotas or budget limits, or repeatedly submit tasks through automation. Self-service password recovery, account closure, and account-data deletion are not currently provided. Prepare a feedback report and share it with your project contact for review.'],
    ['涉及未成年人出镜或使用时，应取得其监护人必要的同意与指导，不提交侵犯未成年人权益的素材。', 'Where minors appear or use the service, obtain the necessary consent and guidance of their guardian. Do not submit material that infringes minors’ rights.'],
  ] },
  { id: 'materials', title: ['素材授权与创作边界', 'Material permissions & creative boundaries'], paragraphs: [
    ['仅上传你拥有或已获必要授权的服装图片、人物视频及其他素材。涉及他人的肖像、声音、个人信息或受保护作品时，应先取得适用授权；可从网络访问不等于可以随意使用。', 'Upload only clothing images, personal videos, and other material you own or have permission to use. Obtain applicable permissions for others’ likeness, voice, personal information, or protected works. Publicly accessible material is not automatically free to use.'],
    ['不要制作或传播违法内容、侵犯隐私的偷拍内容、未经同意的性化内容、欺诈或冒充他人的内容，也不要利用生成结果骚扰、诽谤或伤害他人。不得尝试破坏系统、窃取数据或绕过安全限制。', 'Do not create or distribute unlawful material, privacy-invasive recordings, non-consensual sexualized content, fraud, or deceptive impersonation. Do not use results to harass, defame, or harm others, or attempt to compromise the system, steal data, or bypass safeguards.'],
    ['使用本服务不向映想转让你的原始素材权利。为完成你主动发起的处理，需要将必要素材交由相关处理服务处理；这不构成向映想授予公开展示、销售或广告使用素材的概括授权。', 'Using the service does not transfer your rights in original materials to Yingxiang. Processing you initiate requires necessary materials to be processed by relevant services. This does not give Yingxiang a blanket right to publicly display, sell, or use your materials in advertising.'],
  ] },
  { id: 'cloud', title: ['相机、云端处理与数据', 'Camera, cloud processing & data'], paragraphs: [
    ['打开相机仅在本机预览，不采集音频，不默认录制。主动确认并开始实时换装后，服装图及无声画面会发送至 Decart 生成服务；关闭相机、切到后台、退出账号或离开实时页面会停止媒体连接。', 'Opening the camera provides a local preview only. Audio is not captured, and recording is not enabled by default. After you explicitly confirm and start live try-on, garment images and silent video are sent to Decart for generation. Closing the camera, moving to the background, signing out, or leaving the live page stops media connections.'],
    ['上传视频含音轨时，会先经映想服务器在内存中去除音轨；无声视频与服装图仅在主动生成时发送给生成服务。离开页面不会取消已提交的视频任务。素材可能由第三方云端服务处理；具体处理路径和留存边界请阅读《隐私与使用说明》。', 'Videos containing audio are first processed in server memory to remove audio tracks. Silent video and garment images are sent to the generation service when you actively start generation. Leaving the page does not cancel a submitted video task. Materials may be processed by a third-party cloud service; see Privacy & usage for processing and retention details.'],
    ['本地预览、云端生成、主动录制以及反馈报告是不同操作。本页协议不能替代具体场景的权限请求和处理确认；拒绝云端生成不影响可用的本机预览。', 'Local previews, cloud generation, optional recording, and feedback reports are separate actions. These terms do not replace feature-specific permission requests or processing confirmations. Declining cloud generation does not prevent available local previews.'],
  ] },
  { id: 'credits', title: ['积分、体验与支付', 'Credits, trials & payments'], paragraphs: [
    ['三档套餐为轻享包、创作包和进阶包。轻享包覆盖实时换装和视频换装，后两档包含实时编辑开放后的对应权益。套餐积分长期有效，不自动续费；不同创作方式共用一份积分，功能费率与预计消耗以确认页面为准。', 'The three packages are Light, Creator, and Plus. Light covers live and video try-on; the other two include access to live editing when available. Package credits do not expire and do not auto-renew. Features draw from one shared credit balance; rates and estimated usage are shown at confirmation.'],
    ['当前仅接入 Stripe 沙盒测试，不会真实扣款。测试订单、测试积分与真实生成额度相互隔离；测试付款成功不代表获得可调用真实模型的权限。不要在沙盒中输入真实支付卡信息，请使用 Stripe 官方测试支付资料。', 'Only Stripe sandbox payments are connected. No real money is charged. Test orders and credits are separate from real-generation allowances; successful test payment does not grant access to a live model. Do not enter real card details in the sandbox; use Stripe’s official test payment information.'],
    ['选择套餐不会下单；点击购买后可核对套餐、积分、功能与应付金额，再决定是否前往 Stripe。价格或规则后续调整应在购买前清晰展示，不以本页更新为由追溯改变已确认订单。正式收款、退款及争议处理流程尚未开放，不据此排除用户依法享有的权利。', 'Selecting a package does not create an order. The purchase button opens a summary of the package, credits, features, and total before you choose whether to continue to Stripe. Future prices or rules must be clearly shown before purchase; updates to this page do not retroactively alter confirmed orders. Live payments, refunds, and payment dispute handling are not yet available. Your statutory rights are not excluded.'],
    ['实时体验时长从返回的生成画面开始播放后计算，同一连接内换衣不延长时长。遇到超时或结果未知，请先核对使用记录、任务历史和订单；不要连续提交。额度调整需根据实际处理与记录核查，不承诺失败自动返还，也不将结果未知直接视为成功。', 'Live experience time starts when returned generated video begins playing. Switching garments in the same connection does not extend it. For timeouts or unknown outcomes, review usage, task history, and orders before retrying. Allowance adjustments require checking actual processing and records; neither automatic refunds for every failure nor automatic success for unknown outcomes is promised.'],
  ] },
  { id: 'results', title: ['生成结果与保存', 'Generated results & saving'], paragraphs: [
    ['生成画面可能存在衣物细节偏差、闪烁、身体或背景失真，不保证尺码、面料、合身程度或每次生成的一致性。请自行检查结果是否适合预期用途，不将换装演示作为实物商品效果的保证。', 'Generated results may contain inaccurate garment details, flicker, or distorted bodies and backgrounds. Sizing, fabric, fit, and consistency are not guaranteed. Review whether each result is suitable for your intended use; try-on demonstrations are not guarantees about physical products.'],
    ['生成结果的使用仍需遵守原始素材授权、第三方规则和适用法律。本服务不保证结果具有独占性、必然获得著作权或可以不经审查用于商业用途。发布可能造成误认的合成内容时，应清晰说明其为生成或编辑画面，并履行适用的标识要求。', 'Use of results remains subject to source-material permissions, third-party terms, and applicable law. The service does not guarantee exclusivity, copyright eligibility, or unrestricted commercial use. When publishing synthetic content that may mislead others, clearly identify it as generated or edited and follow applicable labeling requirements.'],
    ['实时换装需开始前主动勾选保存，结束后下载本机录像。视频任务历史不等于永久云盘，本站结果访问窗口为提交后 24 小时，第三方实际可下载期限也会影响访问。请及时下载；刷新、离页或换号可能清除本机临时内容。', 'To save live try-on, opt in before starting and download the local recording afterward. Video task history is not permanent cloud storage. The site’s result-access window is 24 hours from submission, also subject to the provider’s actual availability. Download promptly; refreshing, leaving, or changing accounts may clear local temporary content.'],
  ] },
  { id: 'service', title: ['服务变化与合理保障', 'Service changes & reasonable safeguards'], paragraphs: [
    ['网络、设备、浏览器能力及第三方服务会影响连接、等待和生成效果。内测功能可能维护、限流或暂停；可预见的重大变化应通过页面提示，并在可行时给出保存和退出的机会。', 'Networks, devices, browser capabilities, and third-party services affect connections, waiting times, and results. Test features may require maintenance, rate limits, or suspension. Foreseeable significant changes should be communicated in the interface, with an opportunity to save work and exit where feasible.'],
    ['对涉嫌滥用或侵权的行为，可采取与风险相称的限制措施；处理应基于必要范围，不以笼统声明免除依法应承担的责任。对于错误限制、权益差异或其他争议，可以整理反馈报告提出核查请求。', 'Suspected abuse or infringement may lead to proportionate restrictions limited to what is necessary. General notices do not remove responsibilities imposed by law. You may prepare a feedback report to request review of mistaken restrictions, entitlement discrepancies, or other disputes.'],
  ] },
  { id: 'contact', title: ['反馈、权利请求与协议更新', 'Feedback, rights requests & updates'], paragraphs: [
    ['问题反馈页可在本机整理、复制或下载报告，目前不会在线发送或建立工单。请将报告交给邀请你体验的项目维护者；隐私、素材侵权或订单问题，请提供必要事实和相关编号，不提供密码或完整支付信息。不承诺尚未建立的全天客服或固定处理时限。', 'The feedback page prepares reports locally for copying or downloading; it does not send them online or create tickets. Share reports with the project contact who invited you. For privacy, infringement, or order issues, provide necessary facts and references, not passwords or full payment information. No round-the-clock support or fixed response time is promised.'],
    ['对使用范围、费用或数据处理的实质性变更，应在变更生效前以清晰方式说明；依法需要另行同意的事项，应另行征得同意。存在争议时可先协商，也可依法向主管部门投诉或向有管辖权的人民法院寻求解决；本页不限制依法享有的救济渠道。', 'Material changes to scope, charges, or data processing should be clearly explained before taking effect. Separate consent must be obtained where required by law. Disputes may be discussed first, or raised with competent authorities or courts with jurisdiction as permitted by law. These terms do not restrict statutory remedies.'],
  ] },
];

export function TermsPage() {
  const { locale, t } = useI18n();
  const pick = (copy: Copy) => copy[locale === 'en' ? 1 : 0];
  return <SiteShell active="terms"><main className={s.page}>
    <header className={s.header}><p className={s.eyebrow}>{pick(['映想 · 创作也需要清楚的约定', 'Yingxiang · Clear terms for creating'])}</p><h1>{t('用户协议')}</h1><p>{pick(['你掌握创作的选择，也应知道服务的边界。这里说明账号、素材、生成、支付与保存的约定。', 'You control your creative choices and should understand the service’s boundaries. Here are the terms for accounts, materials, generation, payments, and saving.'])}</p><div className={s.meta}><span>{pick(['内测版 · v1.0', 'Test version · v1.0'])}</span><time dateTime="2026-10-25">2026-10-25</time></div></header>
    <div className={s.layout}><aside className={s.aside}><h2>{pick(['快速阅读', 'On this page'])}</h2><nav aria-label={pick(['协议目录', 'Terms contents'])}>{sections.map(section => <a key={section.id} href={`#${section.id}`}>{pick(section.title)}</a>)}</nav><Link href="/privacy">{t('隐私与使用说明')} ↗</Link><Link href="/help/feedback">{t('问题反馈')} ↗</Link></aside>
      <article className={s.panel}><div className={s.notice}><strong>{pick(['开始前，先知道这三件事', 'Three things to know before starting'])}</strong><p>{pick(['相机预览不等于上传；当前支付仅为沙盒；实时编辑仍是交互预览。实际生成需要另行确认，并受服务开放和账号权益限制。', 'Camera preview is not an upload. Payments are sandbox-only. Live editing is still an interactive preview. Generation requires a separate confirmation and is subject to availability and account entitlements.'])}</p></div>
        {sections.map(section => <section key={section.id} id={section.id} className={s.section}><h2>{pick(section.title)}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{pick(paragraph)}</p>)}</section>)}
        <div className={s.links}><Link href="/privacy">{t('隐私与使用说明')} ↗</Link><Link href="/help/feedback">{t('问题反馈')} ↗</Link><Link href="/pricing">{t('价格方案')} ↗</Link></div>
      </article>
    </div>
  </main></SiteShell>;
}
