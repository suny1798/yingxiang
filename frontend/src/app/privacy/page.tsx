import { localizedMetadata } from '@/lib/server/localized-metadata';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site/site-shell';
import s from './privacy.module.css';

export async function generateMetadata(): Promise<Metadata> { return localizedMetadata({ title: '隐私与使用说明 · 映想', description: '了解相机预览、云端处理、视频保存与历史记录。' }); }

export default function PrivacyPage() {
  return <SiteShell active="privacy"><main className={s.page}>
    <header><p>映想 · 画面与数据</p><h1>隐私与使用说明</h1><p>了解画面何时离开本机、如何保存，以及你可以控制什么。</p></header>
    <nav aria-label="说明目录"><a href="#realtime">实时换装</a><a href="#video">视频换装</a><a href="#edit">实时编辑</a><a href="#records">保存与历史</a></nav>
    <section id="realtime"><h2>实时换装</h2><p>打开相机只在本机预览，不上传画面，也不消耗云端体验次数。勾选同意云端处理并点击开始后，服装图和无声视频画面才会发送至 Decart 进行生成。</p><p>请使用有权上传的素材，并取得出镜者同意。生成画面开始播放后计时；换衣不延长本次时长。结束换装会断开生成连接；关闭相机、退出账号、切到后台或离开页面会停止媒体。</p><p>不默认录制。开始前主动勾选“保存本次生成视频”，才会在本机内存录制生成画面，不含音频、界面或相机原画。下载方向与点击下载时的镜像设置一致。</p></section>
    <section id="video"><h2>视频换装</h2><p>支持 1—15 秒、最大 25MB 的 MP4 / H.264 视频，画面比例支持横版 16:9、2:1 和竖版 9:16、1:2。</p><p>无音轨视频可直接本地预览。检测到音轨时，系统会先上传至映想服务器，在内存中自动去除音轨；界面显示处理进度，可随时取消。音频不发送给生成模型。</p><p>勾选同意云端处理并点击生成后，处理好的无声视频和所选服装图会经映想服务器发送至 Decart。离开页面不会取消已提交的云端任务；若提交结果未知，请先核查历史记录，避免重复生成。</p><p>镜像只调整预览与下载方向，不改变上传素材方向。镜像下载在本机处理，需要保持页面可见；优先导出 MP4，浏览器不支持时使用 WebM。视频换装额度独立于实时体验。</p></section>
    <section id="edit"><h2>实时编辑</h2><p>当前为新版交互预览：打开相机、发送、叠加和删除提示词仅作用于本页界面，尚未同步生成模型。不上传相机画面或提示词，不采集音频，不录制视频。提示词暂存在本页内存，刷新或离开后清空。</p></section>
    <section id="records"><h2>保存与历史记录</h2><p>映想服务器不将输入图片、视频或生成结果文件保存到磁盘；视频预处理使用临时内存。账号、权益、任务状态、历史名称和归档状态等业务元数据存入数据库。</p><p>历史记录用于管理已生成任务，并不代表媒体永久保存。本站结果访问窗口为任务提交后 24 小时；供应商实际留存及可下载期限以其政策和服务返回为准，请及时下载。归档只整理历史列表，不代表删除供应商持有的数据。</p><p>本地上传预览与实时录像在刷新、离开页面或切换账号后可能清除，请先下载需要保留的视频。镜像导出不重新调用生成模型。生成结果用于视觉参考，不保证尺码或合身效果。</p><p>第三方云端处理规则请参阅 <a href="https://docs.platform.decart.ai/resources/privacy-policy" target="_blank" rel="noopener noreferrer">Decart 隐私说明 ↗</a>。</p></section>
    <Link className={s.back} href="/studio" prefetch={false}>进入创作空间 ↗</Link>
  </main></SiteShell>;
}
