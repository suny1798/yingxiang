/** 仅当前页内存的固定阶段与相对耗时；不包含URL、凭据、提示词或SDK原始对象。 */
export const CONNECTION_STAGE_LABELS = {
  checkingService: '检查编辑服务', preparingSdk: '准备模型组件', requestingToken: '申请短期令牌',
  tokenReady: '令牌已取得，等待模型连接', signaling: '建立模型信令与媒体连接', queued: '供应商正在排队',
  connected: '模型连接已建立，等待视频', generating: '模型已开始生成，等待播放',
  remoteStream: '收到远端视频流，等待播放', playing: '生成视频已开始播放',
  socketClosed: '模型信令连接关闭', roomTimeout: '等待媒体房间超时',
} as const;
export type ConnectionStage = keyof typeof CONNECTION_STAGE_LABELS;
export interface ConnectionStep { stage: ConnectionStage; elapsedMs: number }

export function safeConnectionStage(message: string): ConnectionStage | null {
  if (message === 'realtime connect: starting') return 'signaling';
  if (message === 'signaling: websocket closed') return 'socketClosed';
  if (message === 'signaling: livekit_room_info timeout') return 'roomTimeout';
  return null;
}

export function connectionTimeoutMessage(steps: readonly ConnectionStep[]): string {
  const last = steps.at(-1);
  const stage = last ? CONNECTION_STAGE_LABELS[last.stage] : '准备连接';
  return `连接等待超过30秒，仍未收到可播放的生成画面，本轮已停止。最后阶段：${stage}。请保留连接诊断并核对供应商用量，不要连续重试。`;
}
