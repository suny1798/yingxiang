'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { useState } from 'react';
import s from './help-center.module.css';

import { categories, questions, guides, filterHelpQuestions, type Category } from '@/lib/public-help';

export function HelpCenter() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('全部问题');
  const results = filterHelpQuestions(query, category, t);
  const searching = query.trim().length > 0;

  return <main className={s.page}>
    <header className={s.hero}>
      <div><p className={s.eyebrow}>{t("映想使用指南")}</p><h1>{t("帮助中心")}<br /><span>{t("使用指南与常见问题")}</span></h1><p className={s.intro}>{t("三种创作模式的操作步骤、素材要求与常见问题均在此页。")}</p></div>
      <div className={s.searchPanel}>
        <label htmlFor="help-search">{t("搜索问题")}</label>
        <div className={s.search}><span aria-hidden="true">⌕</span><input id="help-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("试试“镜像”“音轨”或“下载”")} aria-controls="help-questions" />{query && <button type="button" onClick={() => setQuery('')} aria-label={t("清空搜索")}>×</button>}</div>
        <div className={s.suggestions}><span>{t("常用搜索")}</span>{['相机', '镜像', '音轨', '积分'].map(word => <button key={word} type="button" onClick={() => { setCategory('全部问题'); setQuery(t(word)); }}>{t(word)}</button>)}</div>
        <p>{t("搜索只在本页进行，不会上传你的输入。")}</p>
      </div>
    </header>

    {!searching && <section aria-labelledby="guide-heading" className={s.guides}>
      <div className={s.sectionHead}><h2 id="guide-heading">{t("创作模式快速指南")}</h2><span>{t("选择模式查看操作步骤")}</span></div>
      <div className={s.guideGrid}>{guides.map(guide => <article key={guide.href} className={s.guide}>
        <div className={s.guideTitle}><span aria-hidden="true">{t(guide.symbol)}</span><h3>{t(guide.title)}</h3>{guide.href.endsWith('edit') && <small>{t("测试开放")}</small>}</div><p>{t(guide.intro)}</p>
        <ol>{guide.steps.map(step => <li key={step}>{t(step)}</li>)}</ol><Link href={guide.href} prefetch={false}>{t(guide.action)}<span aria-hidden="true">↗</span></Link>
      </article>)}</div>
    </section>}

    <section className={s.reference} aria-labelledby="questions-heading">
      <aside className={s.sidebar}><h2 id="questions-heading">{t("按分类")}<br />{t("查找问题")}</h2><nav aria-label={t("问题分类")}>{categories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}><span>{t(item)}</span><span>{item === '全部问题' ? questions.length : questions.filter(q => q.category === item).length}</span></button>)}</nav><Link href="/privacy">{t("画面与隐私说明 ↗")}</Link></aside>
      <div id="help-questions" className={s.questions}>
        <div className={s.resultsHead}><p role="status" aria-live="polite">{t(searching ? `找到 ${results.length} 个相关问题` : `${category} · ${results.length} 个答案`)}</p>{(searching || category !== '全部问题') && <button type="button" onClick={() => { setQuery(''); setCategory('全部问题'); }}>{t("重置筛选")}</button>}</div>
        {results.length ? results.map(question => <details className={s.question} key={question.id}>
          <summary>{t(question.title)}<span aria-hidden="true">+</span></summary><div className={s.answer}>{question.answer.map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}{question.href && <Link href={question.href} prefetch={false}>{t(question.link)} ↗</Link>}</div>
        </details>) : <div className={s.empty}><span aria-hidden="true">⌕</span><h3>{t("还没找到这个问题")}</h3><p>{t("试试更短的关键词，或切换到“全部问题”。")}<br />{t("例如搜“下载”，也能找到格式和镜像的说明。")}</p><button type="button" onClick={() => { setQuery(''); setCategory('全部问题'); }}>{t("查看全部问题")}</button></div>}
      </div>
    </section>

    <section className={s.support} aria-labelledby="support-heading"><div><p className={s.eyebrow}>{t("问题反馈")}</p><h2 id="support-heading">{t("反馈问题时")}<br />{t("请提供完整信息")}</h2><p>{t("在反馈页生成问题报告，复制或下载后交给项目维护者。当前不会在线发送或建立工单。")}</p><Link href="/help/feedback">{t("整理问题反馈 ↗")}</Link></div><div className={s.checklist}><h3>{t("反馈时请提供以下信息")}</h3><ul><li>{t("在哪个功能、进行到哪一步")}</li><li>{t("问题出现的时间与完整提示")}</li><li>{t("浏览器名称，以及素材时长、大小和格式")}</li><li>{t("必要的截图；请遮住个人信息")}</li></ul><p>{t("不用提供密码，也不用发送未经同意的人物素材。")}</p></div></section>
  </main>;
}
