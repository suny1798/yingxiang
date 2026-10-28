"""运维命令的稳定错误码与退出码；不输出原始异常或敏感值。"""
from __future__ import annotations


class OpsError(Exception):
    code = "OPS_FAILED"
    exit_code = 1

    def __init__(self, code: str | None = None):
        self.code = code or self.code
        super().__init__(self.code)


class UsageError(OpsError):
    code = "USAGE_INVALID"
    exit_code = 2


class TargetError(OpsError):
    code = "TARGET_REJECTED"
    exit_code = 3


class SourceError(OpsError):
    code = "SOURCE_REJECTED"
    exit_code = 4


class VerifyError(OpsError):
    code = "VERIFY_DIFFERENCES"
    exit_code = 5


class StorageError(OpsError):
    code = "STORAGE_FAILED"
    exit_code = 6
