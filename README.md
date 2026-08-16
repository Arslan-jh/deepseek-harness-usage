# DeepSeek Usage for DSH

[![CI](https://github.com/Arslan-jh/dsh-deepseek-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/Arslan-jh/dsh-deepseek-usage/actions/workflows/ci.yml)
[![DeepSeek Harness Plugin](https://img.shields.io/badge/DeepSeek_Harness-plugin-4f46e5)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DeepSeek Harness（DSH）Web 插件：在对话统计区持续显示「今日消费 · 总余额」。

> A small DeepSeek Harness web plugin that shows the account balance and an evidence-bounded estimate of today's CNY consumption directly below the conversation composer.

- **总余额**来自 DeepSeek 公开余额接口。
- **今日消费**默认按账户余额差估算，新的一天首次运行时会用本机 DSH 会话日志补齐零点后的消费。
- **充值感知**分别跟踪充值余额和赠送余额，避免充值把当天消费清零。
- **可选校准**允许手动输入平台显示的今日消费。
- **可选平台 token**会尝试调用 `platform.deepseek.com` 网页使用的内部接口；它不是公开 API，失效时会明确提示并自动回退估算。

## 安装 / Install

从 GitHub 安装，不要使用无 scope 的 npm 同名包：

```sh
dsh plugin --profile web add github:Arslan-jh/dsh-deepseek-usage
dsh --profile web
```

如果本机只通过 `npx` 使用 DSH：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:Arslan-jh/dsh-deepseek-usage
npx @deepseek-ai/dsh --profile web
```

包声明了 `dsh.bundle`，安装命令会把它加入目标 profile，无需手工编辑 `cordis.patch.yml`。刷新页面后，进入一个已有会话即可看到用量行。

卸载：

```sh
dsh plugin --profile web remove @arslan-jh/dsh-deepseek-usage
```

## 工作方式 / How it works

宿主和浏览器均每 3 分钟刷新一次：

1. 宿主从 DSH 凭据服务解析 `DEEPSEEK_API_KEY`，查询 DeepSeek 账户总余额。
2. 同一天内按余额分量识别充值和赠送额度变化。
3. 新的一天以当前余额为基线，只叠加当天本机 DSH 日志按公开价格表计算出的消费，不继承昨日余额。
4. 页面显示 `≈` 时表示估算。若其他机器、应用或 API 客户端也使用同一账户，它们造成的余额变化也会计入。

当前内置价表只包含有公开依据的固定单价。未获公开文档支持的未来价格或峰谷时段不会写入代码。DeepSeek 调价后应更新并重新验证价表。

## 数据口径与限制 / Accuracy boundaries

- 账户总余额来自 DeepSeek 的公开接口，是账户级数据。
- 没有平台 token 时，“今日消费”是余额差估算，不等同于平台账单明细。
- 日志回放只覆盖本机 DSH 会话，用于补齐零点到首次余额采样之间的空白；它不会假装知道其他客户端的逐请求明细。
- 平台 token 功能依赖官网页面内部接口，可能随官网更新失效；失效不会阻断余额显示。

官方参考：

- [查询账户余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)
- [模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)

## 权限与安全 / Permissions & security

插件会：

- 通过 DSH 凭据服务读取 `DEEPSEEK_API_KEY`，以及用户主动配置时的 `DEEPSEEK_PLATFORM_TOKEN`；
- 访问 `api.deepseek.com`，可选访问 `platform.deepseek.com`；
- 读取本机 DSH 会话持久化接口，用于当天首次启动时的日志回放；
- 写入 `$DSH_HOME/storages/deepseek-usage-day.json` 保存余额基线。

插件不会把密钥返回给浏览器，也不包含遥测。浏览器只访问本机路由 `/api/ds-usage` 和 `/api/ds-usage-config`；配置写接口要求同源 `application/json` 请求，正文上限 64 KiB。

## 兼容性 / Compatibility

- Node.js 22+
- `@deepseek-ai/cordis` 4.x
- DeepSeek Harness `0.1.0-rc.6` 对应的 credentials/session-persistence seams
- DSH Web profile

## 开发验证 / Development

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

当前仓库采用 GitHub 源安装，并保留 `private: true`，以防误发布到无 scope 的公共 npm 包名。未来只有在确认 npm 账户与 scope 归属后，才会发布 `@arslan-jh/dsh-deepseek-usage`。

## License

[MIT](LICENSE)
