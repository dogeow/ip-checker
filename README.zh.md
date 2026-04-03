# IP 地址检测

全方位查询您的 IP 地址，从不同网络路径检测出口，快速判断直连与分流状态。

[English](./README.md)

## 功能特性

- **多源检测** — 从国内、国外、Google、Cloudflare 四个独立网络路径检测出口 IP
- **延迟显示** — 实时显示每个检测的响应延迟（单位：ms）
- **API 源信息** — 显示成功响应的具体 API 端点
- **IPv6 支持** — 同时支持 IPv4 和 IPv6 地址检测
- **位置信息** — 自动查询 IP 的地理位置信息
- **检测汇总** — 快速判断网络状态（直连/已分流/被封锁）
- **无隐私泄露** — 所有检测在浏览器端完成，不收集任何数据

## 检测说明

### 从国内测试

- 使用国内 IP 查询 API（ipip.net、useragentinfo、pconline）
- 显示访问国内网站所使用的 IP 地址

### 从国外测试

- 使用多个国外 IP 查询 API（ipify、ip.sb、httpbin、amazonaws）
- 显示访问海外站点所使用的 IP 地址

### 从谷歌测试

- 尝试访问 Google checkip 和 Google 生成的 204 响应端点
- 检测谷歌系服务的可达性和出口 IP

### 从 Cloudflare 测试

- 使用 Cloudflare 的 /cdn-cgi/trace 端点
- 获取 Cloudflare 链路的出口 IP 和国家代码

## 网络状态判断

| 状态 | 含义 | 显示 |
| ------ | --------- | --------- |
| 直连 | 所有出口 IP 相同 | 同一出口 |
| 已分流 | 检测到多个不同出口 | 已检测到 N 个出口 |
| 部分封锁 | 部分链路被阻断 | 部分链路被阻断 |
| 高度封锁 | Google 和 CF 均被拦截 | 谷歌 & CF 均被阻断 |
| 不可用 | 全部检测失败 | 全部失败 |

## 使用方法

1. 在浏览器中打开 `index.html`
2. 页面会自动检测四个来源的 IP 地址
3. 点击"重新检测"按钮可刷新结果
4. 悬停或点击 IP 卡片上的 📋 按钮可复制 IP 地址

## 技术栈

- **语言**: 原生 JavaScript（无框架）
- **样式**: 原生 CSS with CSS 变量
- **浏览器 API**:
  - Fetch API with abort signal
  - Clipboard API
  - Performance API（延迟测量）
- **第三方 API**:
  - ipip.net、useragentinfo.com、pconline.com.cn（国内）
  - ipify.org、ip.sb、httpbin.org、amazonaws.com（国外）
  - google.com、googleapis.com、gstatic.com（谷歌）
  - 1.1.1.1、cloudflare.com（Cloudflare）
  - ipinfo.io（地理位置）

## 开发

项目结构非常简洁：

- `index.html` — 页面结构
- `app.js` — 全部业务逻辑（约 550 行）
- `styles.css` — 样式定义（约 540 行）

### 关键超时时间

- 国内 API：6 秒
- 国外 API：7 秒
- 其他请求：8 秒
- 按钮防抖：1.2 秒
- Toast 显示：1.8 秒

### 扩展 API 源

编辑 `app.js` 中的 `DOMESTIC_APIS` 或 `FOREIGN_APIS` 数组：

```javascript
const DOMESTIC_APIS = [
  {
    url: "https://your-api.com/json",
    parse: (data) => ({
      ip: data.ip,
      location: data.location,
    }),
  },
  // ...添加更多国内 API 端点
];
```

## 隐私政策

- ✅ **完全本地运行** — 所有检测均在您的浏览器中执行
- ✅ **无数据收集** — 本页面不收集、存储、传输任何用户数据
- ✅ **无追踪脚本** — 不使用分析、统计或广告服务

外部 API 调用遵循各自的隐私政策（如 ipinfo.io），请阅读相关服务的隐私声明。

## License

MIT
