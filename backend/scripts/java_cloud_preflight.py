"""只读云条件检查；不转发原始驱动日志或配置。"""
import argparse,json,subprocess
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument("--file",type=Path,default=Path("config/application-local.yml"));args=p.parse_args()
 root=Path(__file__).resolve().parents[1]
 result=subprocess.run(["java","-Duser.language=en","-Dlogback.configurationFile=migration-probe-logback.xml",
   "-Dloader.main=cn.yingxiang.bootstrap.CloudPreflight","-cp",str(root/"target/yingxiang-backend-0.1.0.jar"),
   "org.springframework.boot.loader.launch.PropertiesLauncher",str(args.file.resolve())],cwd=root,capture_output=True,timeout=45)
 try:
  report=json.loads(result.stdout)
  allowed={"serverVersionNumber","postgresTls","superuser","canCreateDatabase","canCreateRole","canCreateSchema","schemaVersions","allMigrationsSuccessful","redisTlsConfigured","cloudBackupVerified","businessDataRead","writes","code"}
  assert isinstance(report,dict) and set(report)<=allowed
  assert report.get("writes",False) is False and report.get("businessDataRead",False) is False
 except Exception:report={"code":"PREFLIGHT_OUTPUT_SUPPRESSED"}
 print(json.dumps(report,ensure_ascii=True));return result.returncode
if __name__=="__main__":raise SystemExit(main())
