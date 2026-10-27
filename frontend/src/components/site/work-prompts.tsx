'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/preferences';
import type { WorkPromptHistory } from '@/lib/api-schema';
import s from './works-page.module.css';

export function WorkPrompts({ id, owner, saving }: { id: string; owner: string; saving: boolean }) {
  const { t } = useI18n();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: WorkPromptHistory; error?: boolean } | null>(null);
  const key = `${owner}:${id}`;
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(`/api/works/${id}/prompts`, { cache: 'no-store', signal: controller.signal, headers: { 'X-Work-Owner': owner } });
        if (!response.ok) throw new Error();
        const data = await response.json() as WorkPromptHistory;
        if (!controller.signal.aborted) setResult({ key, data });
      } catch { if (!controller.signal.aborted) setResult({ key, error: true }); }
    };
    void read();
    const timer = saving ? setInterval(() => { if (!document.hidden) void read(); }, 3000) : undefined;
    return () => { controller.abort(); clearInterval(timer); };
  }, [id, owner, key, revision, saving]);
  const value = result?.key === key ? result : null;
  const states = value?.data?.states;
  const time = (ms: number) => `00:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  return <aside className={`${s.referencePanel} ${s.promptPanel}`} aria-label={t('本次提示词')}>
    <h3>{t('本次提示词')}{states && <span>{states.length} {t('组')}</span>}</h3>
    {!value ? <p role="status">{t('正在读取提示词…')}</p> : value.error ? <p role="alert">{t('提示词暂时无法读取。')} <button type="button" className={s.promptRetry} onClick={() => setRevision(value => value + 1)}>{t('重试')}</button></p> : !states?.length ? <p>{t(saving ? '提示词正在随作品保存。' : '这件作品未留存当时的提示词，无法补回。')}</p> : <>
      <p className={s.promptHint}>{t('按同步顺序展示本轮使用的提示词组合。')}</p>
      <div className={s.promptScroll} tabIndex={0} aria-label={t('提示词组合记录')}>
        {states.map((state, index) => <section className={s.promptState} key={index}>
          <div><time>{time(state.atMs)}</time><span>{t(index === 0 ? '初始组合' : '更新组合')}</span></div>
          <ol>{state.instructions.map((text, item) => <li key={item}>{text}</li>)}</ol>
        </section>)}
      </div>
    </>}
  </aside>;
}
