# 映想 UI 原型 V1

**让想象，在眼前发生。**

映想定位为实时画面创作；当前原型展示首个实时换装场景，提示词、室内背景、宠物与摆件等扩展仍在规划中。

纯 HTML、CSS 和 JavaScript，本地运行，无需安装依赖或配置 API Key。

在项目根目录运行：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

浏览器打开 [映想原型](http://127.0.0.1:8765/prototypes/ui-v1/)。如果本机服务已在运行，可直接打开；结束服务使用运行终端的 Ctrl+C。外部 SVG 符号通过 HTTP 加载，不建议直接双击 HTML。

本机可用的 Python 路径为：

```powershell
& 'C:\Users\sun\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 8765 --bind 127.0.0.1
```

先选一份示意素材或上传服装参考图，再确认画面处理说明，点击“开启映想”。底部“预览体验状态”可选择错误、演示连接中断或重新体验。邀请码交互的示意码是 YINGXIANG，不代表正式访问资格。

此原型不访问摄像头、不调用模型、不发送参考图，不存储账号或媒体。“映想画面/原始画面”仅演示标签与交互，人台插画不是模型结果。示意素材是设计走查工具，不自动增加正式首版范围。

文件：index.html 页面，styles.css 视觉令牌及布局，app.js 本地交互，assets/ 原创SVG。设计说明与截图位于 [UI视觉设计方案](../../docs/06-UI视觉设计方案.md)。

当前仅用于设计审核，未部署。用户已授权后续验证通过后自行创建规范的本地 Git 提交；原型保留作设计参考。
