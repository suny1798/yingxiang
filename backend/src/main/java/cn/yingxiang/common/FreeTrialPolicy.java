package cn.yingxiang.common;

/** 视频免费体验的生效时间由生成门禁与本人权益展示共用。 */
public final class FreeTrialPolicy {
    private FreeTrialPolicy() {}
    public static final long VIDEO_SINCE = 1_793_376_000_000L; // 2026-10-31 00:00，Asia/Shanghai
    public static void validateVideoSeconds(double seconds, boolean trialOnly) {
        if (trialOnly && seconds > 10.001) {
            throw new cn.yingxiang.exception.BusinessFailure("VIDEO_TRIAL_DURATION", "免费试用仅支持10秒以内视频，请重新上传。", 400);
        }
    }
}
