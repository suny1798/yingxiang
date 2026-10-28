export type Say = (zh: string, en: string) => string;

export const sceneName = (scene: string, say: Say) => (({
  studio: say('实时换装', 'Live try-on'), prompt: say('实时编辑', 'Live editing'), video: say('视频换装', 'Video try-on'), stripe_sandbox: say('Stripe 沙盒', 'Stripe sandbox'),
} as Record<string, string>)[scene] ?? scene);

export const stateName = (state: string, say: Say) => (({
  reserved: say('已预留', 'Reserved'), unknown: say('待核查', 'Unknown'), issued: say('已签发', 'Issued'), finished: say('已结束', 'Finished'),
  submitting: say('提交中', 'Submitting'), pending: say('待处理', 'Pending'), processing: say('处理中', 'Processing'), completed: say('已完成', 'Completed'), failed: say('失败', 'Failed'),
  creating: say('创建中', 'Creating'), paid: say('已支付', 'Paid'), expired: say('已过期', 'Expired'),
} as Record<string, string>)[state] ?? state);
