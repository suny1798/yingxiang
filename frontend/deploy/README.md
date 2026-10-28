# 隔离静态入口

`nginx.local.conf.template` 供迁移验证使用，不是直接覆盖宝塔或已安装Nginx配置的文件。模板只监听回环，路径和端口由工具填充；不含账号、密钥或生产域名。

在 `frontend/` 执行：

```powershell
npm run build
# nginx须在PATH；否则先指定实际可执行文件的绝对路径
$env:MIGRATION_NGINX_BIN = 'D:/Code/Tools/nginx-1.28.3/nginx.exe'
npm run smoke:nginx
```

工具检查本机Nginx版本，以临时prefix／配置及随机回环端口启动Nginx和合成HTTP上游。47项断言覆盖页面深链接与404、静态资源缓存、API原始字节／查询参数／Cookie／签名、业务拒绝、Range／HEAD、超限413和断开503。退出时只停止工具持有的进程并清理其临时目录，不执行安装目录的全局stop命令。API数据和Cookie均为合成值，真实模型与支付调用为0。

HTML不缓存；带构建哈希的JS／CSS／WASM一年immutable，其他assets一小时，缺失资源不回退HTML且不缓存。未知页面保留HTTP404并交给Vue显示404；未知API保留上游JSON，不落入SPA。入口检查原始Host，保留Origin交给后端验证，并重新设置Forwarded相关头；它不代替后端身份与来源授权。

当前35MiB＋4096字节是外围请求上限，逐接口上传限制仍由后端实施。130秒读写超时是空闲间隔，不是业务总截止；M09仍须处理并验证总截止及上传中断。Windows版Nginx验证不代表Linux／HTTPS生产验收；生产TLS、正式域名、进程托管、日志策略与切换另按M09／后续门槛验收。不要直接公开此本机入口。

官方依据：[Windows注意事项](https://nginx.org/en/docs/windows.html)、[请求转发](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)、[try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。本机实测版本为1.28.3，没有升级现有安装。
