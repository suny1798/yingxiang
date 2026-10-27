import type { Locale } from './i18n';

export const feedbackCategories = [
  ['connection', '相机与连接', 'Camera & connection'],
  ['video', '上传与生成', 'Upload & generation'],
  ['download', '下载与镜像', 'Downloads & mirroring'],
  ['credits', '账号、积分与订单', 'Account, credits & orders'],
  ['idea', '功能建议', 'Feature suggestions'],
  ['rights', '隐私与权益', 'Privacy & rights'],
] as const;

/** 只整理明确提供的字段；不读取设备、Cookie、存储、网络或媒体。 */
export function buildFeedbackReport(category: string, fields: Record<string, unknown>, locale: Locale,
                                    preparedAt = new Date().toISOString()): string | null {
  const get = (key: string) => String(fields[key] ?? '').trim();
  const selected = feedbackCategories.find(item => item[0] === category);
  if (!selected || !get('summary') || !get('details')) return null;
  const say = (zh: string, en: string) => locale === 'en' ? en : zh;
  const label = (zh: string, en: string, value: string) => `${say(zh, en)}\n${value || say('未填写', 'Not provided')}`;
  return [
    say('映想 · 问题反馈报告', 'Yingxiang · Feedback report'),
    say('本报告由用户在本机整理，尚未发送。', 'Prepared locally by the user. Not sent.'),
    label('整理时间', 'Prepared at', preparedAt),
    label('问题分类', 'Category', locale === 'en' ? selected[2] : selected[1]),
    label('所在功能', 'Feature', get('scene')),
    label('问题标题', 'Title', get('summary')),
    label('具体情况与复现步骤', 'What happened & steps to reproduce', get('details')),
    label('发生时间 / 任务或订单编号', 'Time / task or order reference', get('reference')),
    label('浏览器与系统', 'Browser & operating system', get('environment')),
    label('期望的结果', 'Expected outcome', get('expected')),
  ].join('\n\n');
}
