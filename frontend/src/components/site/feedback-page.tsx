'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/components/preferences';
import { notify } from '@/lib/notices';
import { SiteShell } from './site-shell';
import s from './support.module.css';

const categories = [
  ['connection', '相机与连接', 'Camera & connection'],
  ['video', '上传与生成', 'Upload & generation'],
  ['download', '下载与镜像', 'Downloads & mirroring'],
  ['credits', '账号、积分与订单', 'Account, credits & orders'],
  ['idea', '想法与建议', 'Ideas & suggestions'],
  ['rights', '隐私与权益', 'Privacy & rights'],
] as const;

export function FeedbackPage() {
  const { locale, t } = useI18n();
  const say = (zh: string, en: string) => locale === 'en' ? en : zh;
  const [category, setCategory] = useState<string>('connection');
  const [report, setReport] = useState('');
  const [copying, setCopying] = useState(false);
  const preview = useRef<HTMLElement>(null);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? '').trim();
    if (!get('summary') || !get('details')) {
      notify(say('请填写问题标题和具体情况。', 'Please enter a title and describe what happened.'), 'error');
      return;
    }
    const selected = categories.find(item => item[0] === category)!;
    const label = (zh: string, en: string, value: string) => `${say(zh, en)}\n${value || say('未填写', 'Not provided')}`;
    setReport([
      say('映想 · 问题反馈报告', 'Yingxiang · Feedback report'),
      say('本报告由用户在本机整理，尚未发送。', 'Prepared locally by the user. Not sent.'),
      label('整理时间', 'Prepared at', new Date().toISOString()),
      label('问题分类', 'Category', locale === 'en' ? selected[2] : selected[1]),
      label('所在功能', 'Feature', get('scene')),
      label('问题标题', 'Title', get('summary')),
      label('具体情况与复现步骤', 'What happened & steps to reproduce', get('details')),
      label('发生时间 / 任务或订单编号', 'Time / task or order reference', get('reference')),
      label('浏览器与系统', 'Browser & operating system', get('environment')),
      label('期望的结果', 'Expected outcome', get('expected')),
    ].join('\n\n'));
    requestAnimationFrame(() => preview.current?.focus());
  }

  async function copyReport() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(report);
      notify(say('报告已复制，请交给项目维护者；尚未在线提交。', 'Report copied. Share it with your project contact; it has not been submitted online.'), 'success');
    } catch {
      notify(say('无法访问剪贴板，请下载报告，或选中下方文字手动复制。', 'Clipboard unavailable. Download the report or select the text below to copy it manually.'), 'error');
    } finally { setCopying(false); }
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob(['\uFEFF', report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `yingxiang-feedback-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(say('已发起报告下载，文件未上传至服务器。', 'Report download started. The file was not uploaded to a server.'), 'success');
  }

  return <SiteShell active="help"><main className={s.page}>
    <header className={s.header}><p className={s.eyebrow}>{say('映想 · 一起把体验变好', 'Yingxiang · Make creating better')}</p><h1>{say('让卡住的地方，有个出口。', 'A way forward when things get stuck.')}</h1><p>{say('连接卡住、画面不对，或者有一个新想法？把经过告诉我们，好的改进从具体的问题开始。', 'A stalled connection, an unexpected result, or a new idea? Useful improvements start with what actually happened.')}</p></header>
    <div className={s.layout}>
      <aside className={s.aside}><h2>{say('先选一条更短的路', 'Start with a shorter route')}</h2><Link href="/help">{say('排查常见问题 ↗', 'Troubleshoot common issues ↗')}</Link><Link href="/account/usage" prefetch={false}>{say('核对使用记录 ↗', 'Review usage records ↗')}</Link><Link href="/account/orders" prefetch={false}>{say('查看沙盒订单 ↗', 'View sandbox orders ↗')}</Link><p>{say('生成结果未知时，请先查历史记录，避免反复点击产生新任务。', 'If a generation outcome is unknown, check your history before starting another task.')}</p><h2>{say('只带必要的信息', 'Include only what is needed')}</h2><p>{say('不需要密码、验证码、API 密钥或支付卡号。截图请遮住个人信息；人物照片与视频无需随报告提供。', 'Never include passwords, verification codes, API keys, or card numbers. Redact screenshots; personal photos and videos are not needed for this report.')}</p><Link href="/privacy">{t('隐私与使用说明')} ↗</Link></aside>
      <div className={s.panel}>
        <div className={s.notice}><strong>{say('先整理，再分享', 'Prepare first, then share')}</strong><p>{say('当前内测尚未接入在线反馈接收渠道。填写后可预览、复制或下载报告，再交给邀请你体验的项目维护者；这里不会自动发送或建立工单。', 'Online feedback delivery is not connected during this test. Preview, copy, or download your report and share it with the project contact who invited you. This page does not send reports or create tickets.')}</p></div>
        <form className={s.form} onSubmit={prepare} onInput={() => setReport('')}>
          <div className={s.field}><fieldset><legend>{say('这次想反馈什么？', 'What would you like to report?')}</legend><div className={s.options}>{categories.map(item => <button key={item[0]} type="button" className={s.option} aria-pressed={category === item[0]} onClick={() => { setCategory(item[0]); setReport(''); }}>{locale === 'en' ? item[2] : item[1]}</button>)}</div></fieldset></div>
          <div className={s.row}>
            <div className={s.field}><label htmlFor="feedback-scene">{say('所在功能', 'Feature')}</label><select id="feedback-scene" name="scene">{['实时换装', '视频换装', '实时编辑', '账号与支付', '其他页面'].map((label, index) => <option key={label} value={['Live try-on / 实时换装', 'Video try-on / 视频换装', 'Live editing / 实时编辑', 'Account & payments / 账号与支付', 'Other pages / 其他页面'][index]}>{index < 3 ? t(label) : say(label, ['Account & payments', 'Other pages'][index - 3])}</option>)}</select></div>
            <div className={s.field}><label htmlFor="feedback-reference">{say('发生时间 / 相关编号（选填）', 'Time / reference (optional)')}</label><input id="feedback-reference" name="reference" maxLength={160} placeholder={say('例如：今天 14:20，任务编号…', 'e.g. Today at 14:20, task reference…')} /></div>
          </div>
          <div className={s.field}><label htmlFor="feedback-summary">{say('用一句话描述问题（必填）', 'Describe the issue in one sentence (required)')}</label><input id="feedback-summary" name="summary" required maxLength={100} placeholder={say('例如：生成完成后，下载方向和预览不同', 'e.g. The downloaded video faces a different direction from the preview')} /></div>
          <div className={s.field}><label htmlFor="feedback-details">{say('具体发生了什么？（必填）', 'What happened? (required)')}</label><textarea id="feedback-details" name="details" required maxLength={3000} placeholder={say('你依次做了什么？在哪一步出现问题？页面显示了什么提示？\n如果是建议，描述你想完成的事情就好。', 'What did you do, in order? At which step did it go wrong? What did the page say?\nFor suggestions, describe what you would like to achieve.')} /><small>{say('最多 3,000 字。请保留完整错误提示，去掉其中的个人信息。', 'Up to 3,000 characters. Include the error message, with personal details removed.')}</small></div>
          <div className={s.row}><div className={s.field}><label htmlFor="feedback-environment">{say('浏览器与系统（选填）', 'Browser & OS (optional)')}</label><input id="feedback-environment" name="environment" maxLength={160} placeholder={say('例如：Chrome，Windows 11', 'e.g. Chrome, Windows 11')} /></div><div className={s.field}><label htmlFor="feedback-expected">{say('你希望怎样？（选填）', 'What did you expect? (optional)')}</label><input id="feedback-expected" name="expected" maxLength={300} placeholder={say('你期望出现的结果', 'The result you expected')} /></div></div>
          <div className={s.actions}><button className={s.primary} type="submit">{say('整理反馈报告', 'Prepare feedback report')} <span aria-hidden="true">↗</span></button><button className={s.secondary} type="reset" onClick={() => { setCategory('connection'); setReport(''); }}>{say('清空', 'Clear')}</button></div>
        </form>
        {report && <section className={s.result} ref={preview} tabIndex={-1} aria-label={say('反馈报告预览', 'Feedback report preview')}><h2>{say('报告准备好了，还没有发送。', 'Your report is ready. It has not been sent.')}</h2><p>{say('请检查内容，再复制或下载交给项目维护者。修改上方内容后，需要重新整理报告。', 'Review it, then copy or download it to share with your project contact. After changing the form, prepare a new report.')}</p><pre className={s.report}>{report}</pre><div className={s.actions}><button type="button" className={s.primary} disabled={copying} onClick={() => void copyReport()}>{say('复制报告', 'Copy report')}</button><button type="button" className={s.secondary} onClick={downloadReport}>{say('下载文本', 'Download text')}</button></div></section>}
      </div>
    </div>
  </main></SiteShell>;
}
