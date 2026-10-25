'use client';

import { useI18n } from '@/components/preferences';
import Link from 'next/link';
import { useState } from 'react';
import s from './help-center.module.css';

const categories = ['全部问题', '相机与连接', '视频与素材', '保存与镜像', '提示词编辑', '账号与额度'] as const;
type Category = typeof categories[number];
type Question = { id: string; category: Category; title: string; answer: string[]; keywords?: string; href?: string; link?: string };

// 文案以当前实际行为为准；搜索、筛选与展示使用同一份内容。
const questions: Question[] = [
  { id: 'start', category: '相机与连接', title: '第一次使用，应该从哪里开始？', answer: ['进入实时换装，先上传服装参考图，再打开相机。站在光线均匀的位置，让上半身和衣服完整入镜。', '本机预览准备好后，选择可用时长，确认云端处理并开始换装。开始生成需要登录，并具备对应功能的可用额度。'], href: '/studio', link: '进入实时换装' },
  { id: 'camera', category: '相机与连接', title: '打开相机会立即上传画面、消耗次数吗？', answer: ['不会。打开相机仅在本机预览，不上传画面，也不消耗云端体验次数。只有主动确认云端处理并开始生成，才会进入云端流程。', '映想不采集音频，也不会默认录制。'], keywords: '隐私 摄像头 本地' },
  { id: 'permission', category: '相机与连接', title: '相机打不开，或者提示权限被拒绝？', answer: ['点击浏览器地址栏左侧的网站权限入口，允许使用摄像头；再检查电脑系统中的相机权限，确认浏览器可以访问。', '关闭正在占用摄像头的会议或拍摄软件，确认相机已连接，然后重新打开相机。权限仍未生效时，先保存需要的内容，再刷新页面重试。'], keywords: '黑屏 摄像头 授权' },
  { id: 'timer', category: '相机与连接', title: '换装时长从什么时候开始计算？', answer: ['收到服务器返回的生成画面并开始播放后，才开始计算本次换装时长。点击开始后的连接等待阶段不计入画面体验时长。', '同一次连接内切换服装不会延长计时，也不会因为换衣重新签发一次连接。'] },
  { id: 'network', category: '相机与连接', title: '一直连接中，或者画面很慢，怎么办？', answer: ['先确认本机相机预览是否流畅。若本机也卡顿，关闭占用摄像头或大量系统资源的程序；若仅生成画面缓慢，检查网络是否稳定，暂停大文件传输。', '生成依赖云端连接，网络线路会影响等待和流畅度。出现超时或结果未知时，先查看使用记录或视频历史，不要连续点击生成，以免重复提交。'], href: '/account/usage', link: '查看使用记录', keywords: '延迟 卡顿 超时 网络' },
  { id: 'disabled', category: '相机与连接', title: '提示“服务暂未就绪”或“暂未启用”是什么意思？', answer: ['这表示当前功能的云端服务没有开放，或者尚未满足运行条件，不代表摄像头损坏。打开本机相机与云端生成是两个独立步骤。', '查看页面上的功能状态和个人中心的权益。服务未开放时，反复刷新或重新上传不会解除限制。'] },
  { id: 'leave', category: '相机与连接', title: '切换标签页或离开创作空间会怎样？', answer: ['实时换装在切到后台、关闭相机、离开页面或退出账号时会停止媒体与生成连接，不会自动重连。请尽量留在当前页面完成体验。', '视频换装已提交的云端任务不会因为离开页面而取消；返回后可以从历史视频查看任务。未下载的本地录像、素材预览和提示词草稿可能清空。'] },
  { id: 'video-format', category: '视频与素材', title: '上传视频有什么要求？', answer: ['选择 1—15 秒、最大 25MB 的 MP4 视频，视频编码需为 H.264。支持横版 16:9、2:1，以及竖版 9:16、1:2。', '文件后缀是 .mp4 不一定代表编码符合要求。若提示格式不支持，可在视频工具中导出为 H.264 MP4；有声音的视频可以直接交给映想自动处理。'], keywords: '格式 大小 编码 上传失败' },
  { id: 'audio', category: '视频与素材', title: '视频带有声音，需要自己去掉吗？', answer: ['不需要。检测到音轨后，映想会在服务器内存中自动移除音轨，页面显示处理进度，也可以取消。', '完成处理后再预览和生成，无需手动剪辑。音频不会发送给生成模型。'], keywords: '静音 音乐 去音轨 进度条' },
  { id: 'garment', category: '视频与素材', title: '服装图片怎么选，效果会更好？', answer: ['支持 JPG、PNG、WebP，每张最大 10MB。优先选择主体清楚、光线均匀、背景简单的服装正面图，平铺或挂拍都可以。', '实时换装最多放入 6 张参考图，并在连接中点选换衣；视频换装每次使用 1 张服装图。尽量避免遮挡、过小的主体和复杂拼图。'], keywords: '参考图 图片尺寸 衣橱' },
  { id: 'quality', category: '视频与素材', title: '为什么生成的衣服、身体或细节不够准确？', answer: ['尽量保持人物完整入镜，避免手臂长时间遮住衣服、快速转身和强烈明暗变化；参考图中的服装也应清楚可辨。', '生成画面可能出现细节变化、闪烁或不自然的局部。结果适合视觉参考，不代表真实尺码、面料质感或合身程度。'] },
  { id: 'empty', category: '视频与素材', title: '重新打开视频换装，为什么没有上一次的画面？', answer: ['创作区默认从空白开始，不会自动加载旧素材或旧结果。需要查看以前的任务时，请点击视频换装页面右下方的“历史视频”。', '历史记录与本地上传预览不同；刷新页面后，本机临时素材需要重新选择。'], href: '/studio/video', link: '进入视频换装' },
  { id: 'record', category: '保存与镜像', title: '实时换装结束后，怎样下载视频？', answer: ['开始之前勾选“保存本次生成视频”。生成结束后，才能回放并下载本次录像；没有提前勾选，就无法补录已经结束的画面。', '录制仅包含生成画面，不包含音频、界面或相机原画。请在刷新、离开页面或切换账号前完成下载。'], keywords: '录像 录屏 保存' },
  { id: 'download', category: '保存与镜像', title: '视频换装生成完成后，在哪里下载？', answer: ['在结果画面下方点击下载，也可以从“历史视频”打开本人已完成任务并下载。', '结果不是永久云盘：本站访问窗口为任务提交后 24 小时，供应商实际可用期限也可能影响下载。请尽早保存到自己的设备。'], keywords: '过期 有效期 导出' },
  { id: 'mirror', category: '保存与镜像', title: '镜像开关会影响下载的视频吗？', answer: ['会。预览可以随时切换镜像，下载时会按当前界面展示的方向导出。镜像不改变上传给生成服务的素材方向。', '需要调整方向的导出在本机处理，可能需要等待；请保持页面可见，按进度提示操作，也可以取消。不会为此重新调用生成模型。'] },
  { id: 'webm', category: '保存与镜像', title: '为什么下载得到的是 WebM，而不是 MP4？', answer: ['本机录制与方向处理会优先使用 MP4；浏览器不支持对应导出能力时，使用 WebM 保存。下载的后缀与实际格式一致。', '如果后续工具要求 MP4，可以在视频工具中转换格式，直接改文件后缀不会改变编码。'], keywords: '导出格式 浏览器' },
  { id: 'history', category: '保存与镜像', title: '历史视频能做什么？归档等于删除吗？', answer: ['历史视频可以查看本人任务、重命名、下载可用结果，以及归档和恢复记录。归档用于整理列表，不是删除视频文件，也不会延长结果的访问期限。', '映想保存任务状态、名称等业务记录，不将生成媒体永久存放在本站。重要作品请下载到本机。'], keywords: '管理 恢复 重命名 删除' },
  { id: 'edit-status', category: '提示词编辑', title: '实时编辑现在能真正改变画面吗？', answer: ['当前页面是交互预览：可以提前开相机、切换画面入口、发送和删除提示词。提示词还没有同步到生成模型，因此暂时不会产生对应的画面变化。', '页面里的“映想画面”入口和提示词组合展示，不代表已完成真实生成。实时编辑目前也不提供录制下载。'], href: '/studio/edit', link: '体验编辑界面' },
  { id: 'prompt-stack', category: '提示词编辑', title: '提示词如何叠加、删除？会保存下来吗？', answer: ['在画面正下方输入想法，点击发送，提示词会进入左侧列表；新增想法与已有条目一起组成当前组合，删除一条会把它从组合中移除。', '当前增删只影响界面状态，尚不改变生成视频。提示词保存在当前页面内存中，刷新或离开后清空。'], keywords: '历史 输入框 还原' },
  { id: 'prompt-write', category: '提示词编辑', title: '提示词怎么写，比较容易表达清楚？', answer: ['把每条想法写成一个具体变化，方便之后单独移除。例如“把背景换成有落地窗的明亮客厅”“在人物右侧放一盆绿植”。', '尽量交代要修改的对象和希望的结果，避免同时加入互相冲突的要求。这是创作表达建议；当前编辑界面尚未接入画面生成。'] },
  { id: 'plans', category: '账号与额度', title: '三档方案有什么区别？积分会过期吗？', answer: ['轻享包面向实时换装与视频换装；创作包和进阶包的方案包含三个功能。积分长期有效，不自动续费。', '目前新套餐仅接入模拟支付沙盒。测试积分与真实模型体验额度分开，不能因沙盒付款而解锁真实生成；套餐包含实时编辑也不代表该功能已完成接入。'], href: '/pricing', link: '查看三档方案', keywords: '套餐 支付 价格 购买 沙盒' },
  { id: 'quota', category: '账号与额度', title: '有积分，为什么还是不能开始生成？', answer: ['当前沙盒测试积分与真实功能额度独立。实时换装还会检查所选时长的权益，视频换装有独立额度，各功能还需要处于开放状态。', '先在个人中心核对账号、对应功能与可用权益，再按页面提示操作。切换套餐、重登或反复点击都不会自动解除服务限制。'], href: '/account', link: '查看我的权益' },
  { id: 'unknown', category: '账号与额度', title: '生成失败或状态未知，次数会自动退回吗？', answer: ['不同失败阶段的处理不同。无效请求不会扣次数；已经提交但无法确认结果的任务，会保留风险占用，不会简单按失败自动返还。', '先查看使用记录和视频历史，记录出错时间与页面提示，再交给项目维护者核查。删除或归档记录不会恢复额度，请勿立即重复生成。'], keywords: '扣费 退款 超时 重试' },
  { id: 'password', category: '账号与额度', title: '忘记密码了，可以用手机找回吗？', answer: ['目前使用用户名和密码登录，尚未提供手机号验证或自助找回密码。请妥善保存自己的登录信息。', '无法登录时，请联系向你提供体验资格的项目维护者核查；不要在反馈截图或描述中发送密码、验证码或令牌。'] },
];

const guides = [
  { title: '实时换装', symbol: '◉', intro: '先看见自己，再换一种穿搭。', href: '/studio', action: '开始试穿', steps: ['上传服装图，打开相机', '选择时长，确认后开始换装', '切换服装；提前勾选可保存录像'] },
  { title: '视频换装', symbol: '▷', intro: '给拍好的片段，换一件新衣。', href: '/studio/video', action: '选择一段视频', steps: ['选择 1—15 秒的人物视频', '放入服装图，等待音轨自动处理', '确认生成，完成后预览并下载'] },
  { title: '实时编辑', symbol: '✳', intro: '一句一个想法，组合你的画面。', href: '/studio/edit', action: '体验交互预览', steps: ['先打开相机，调整预览方向', '在画面下方输入想法并发送', '在左侧叠加或移除提示词'] },
];

export function HelpCenter() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('全部问题');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = questions.filter(q => (category === '全部问题' || q.category === category) && terms.every(term => [q.title, q.category, q.keywords ?? '', ...q.answer].flatMap(text => [text, t(text)]).join(' ').toLocaleLowerCase().includes(term)));
  const searching = terms.length > 0;

  return <main className={s.page}>
    <header className={s.hero}>
      <div><p className={s.eyebrow}>{t("映想使用手册")}</p><h1>{t("把疑问留在这里。")}<br /><span>{t("把想象带进画面。")}</span></h1><p className={s.intro}>{t("从第一次打开相机，到保存一段满意的作品。")}<br />{t("你需要知道的，都从这里开始。")}</p></div>
      <div className={s.searchPanel}>
        <label htmlFor="help-search">{t("你想了解什么？")}</label>
        <div className={s.search}><span aria-hidden="true">⌕</span><input id="help-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("试试“镜像”“音轨”或“下载”")} aria-controls="help-questions" />{query && <button type="button" onClick={() => setQuery('')} aria-label={t("清空搜索")}>×</button>}</div>
        <div className={s.suggestions}><span>{t("常被问到")}</span>{['相机', '镜像', '音轨', '积分'].map(word => <button key={word} type="button" onClick={() => { setCategory('全部问题'); setQuery(t(word)); }}>{t(word)}</button>)}</div>
        <p>{t("搜索只在本页进行，不会上传你的输入。")}</p>
      </div>
    </header>

    {!searching && <section aria-labelledby="guide-heading" className={s.guides}>
      <div className={s.sectionHead}><h2 id="guide-heading">{t("选一种方式，开始创作")}</h2><span>{t("三条路径，同一个创作空间")}</span></div>
      <div className={s.guideGrid}>{guides.map(guide => <article key={guide.href} className={s.guide}>
        <div className={s.guideTitle}><span aria-hidden="true">{t(guide.symbol)}</span><h3>{t(guide.title)}</h3>{guide.href.endsWith('edit') && <small>{t("交互预览")}</small>}</div><p>{t(guide.intro)}</p>
        <ol>{guide.steps.map(step => <li key={step}>{t(step)}</li>)}</ol><Link href={guide.href} prefetch={false}>{t(guide.action)}<span aria-hidden="true">↗</span></Link>
      </article>)}</div>
    </section>}

    <section className={s.reference} aria-labelledby="questions-heading">
      <aside className={s.sidebar}><h2 id="questions-heading">{t("遇到问题，")}<br />{t("从这里找答案。")}</h2><nav aria-label={t("问题分类")}>{categories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}><span>{t(item)}</span><span>{item === '全部问题' ? questions.length : questions.filter(q => q.category === item).length}</span></button>)}</nav><Link href="/privacy">{t("画面与隐私说明 ↗")}</Link></aside>
      <div id="help-questions" className={s.questions}>
        <div className={s.resultsHead}><p role="status" aria-live="polite">{t(searching ? `找到 ${results.length} 个相关问题` : `${category} · ${results.length} 个答案`)}</p>{(searching || category !== '全部问题') && <button type="button" onClick={() => { setQuery(''); setCategory('全部问题'); }}>{t("重置筛选")}</button>}</div>
        {results.length ? results.map(question => <details className={s.question} key={question.id}>
          <summary>{t(question.title)}<span aria-hidden="true">+</span></summary><div className={s.answer}>{question.answer.map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}{question.href && <Link href={question.href} prefetch={false}>{t(question.link)} ↗</Link>}</div>
        </details>) : <div className={s.empty}><span aria-hidden="true">⌕</span><h3>{t("还没找到这个问题")}</h3><p>{t("试试更短的关键词，或切换到“全部问题”。")}<br />{t("例如搜“下载”，也能找到格式和镜像的说明。")}</p><button type="button" onClick={() => { setQuery(''); setCategory('全部问题'); }}>{t("查看全部问题")}</button></div>}
      </div>
    </section>

    <section className={s.support} aria-labelledby="support-heading"><div><p className={s.eyebrow}>{t("还是没有解决？")}</p><h2 id="support-heading">{t("把问题描述清楚，")}<br />{t("才能更快找回创作状态。")}</h2><p>{t("可以在反馈页整理问题报告，复制或下载后交给项目维护者。当前不会在线发送或建立工单。")}</p><Link href="/help/feedback">{t("整理问题反馈 ↗")}</Link></div><div className={s.checklist}><h3>{t("反馈时，带上这四样")}</h3><ul><li>{t("在哪个功能、进行到哪一步")}</li><li>{t("问题出现的时间与完整提示")}</li><li>{t("浏览器名称，以及素材时长、大小和格式")}</li><li>{t("必要的截图；请遮住个人信息")}</li></ul><p>{t("不用提供密码，也不用发送未经同意的人物素材。")}</p></div></section>
  </main>;
}
