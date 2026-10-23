import type { Metadata } from 'next';
import { VideoStudio } from '@/components/studio/video-studio';
export const metadata: Metadata = { title: '视频换装 · 映想', description: '选择人物短视频与服装参考图，生成后预览、下载换装视频。' };
export default function VideoStudioPage() { return <VideoStudio />; }
