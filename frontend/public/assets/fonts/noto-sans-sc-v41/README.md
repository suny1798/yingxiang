# Noto Sans SC（简体中文无衬线）

用于搭配拉丁字体Inter，统一映想中文品牌、标题、正文与表单。

- 官方字族：https://fonts.google.com/noto/specimen/Noto+Sans+SC
- 官方上游：https://github.com/notofonts/noto-cjk
- 发行来源：Google Fonts的Noto Sans SC v41 CSS及其原始WOFF2字库，2026-10-29下载。
- 字重：100—900可变，正体，font-display: swap。
- 许可：随附OFL.txt（SIL Open Font License 1.1）。字体文件未经修改。
- manifest.json记录每个文件的原始下载URL、大小、SHA-256和许可的固定提交来源。

保留官方unicode-range拆分，以便浏览器只加载页面实际用到的字库分片；不预加载整个中文字库。字体声明位于src/vue/noto-sans-sc.css，仅把原始字体URL替换为同源路径，随主样式构建并获得内容指纹缓存，运行时无Google字体服务依赖。Inter优先覆盖英文和数字，中文使用Noto Sans SC，极少数字符可回退到系统字体。
