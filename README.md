# LLM Router

一个自托管的 OpenAI-compatible 模型路由代理。

它适合已经有一个中转站 `base_url` 和 API Key 的个人开发者：你不需要在客户端里反复手动切换模型，只要把模型名填成 `auto`、`auto-coding` 或 `auto-longtext`，本服务会先用便宜模型做一次路由判断，再把原始请求转发给合适的真实模型。

## 现在能做什么

虚拟模型：

- `auto`：通用自动路由。
- `auto-coding`：偏代码任务的自动路由。
- `auto-longtext`：偏长文本任务的自动路由。

核心原则：

- 路由模型只负责选模型，不直接回答用户。
- 回答模型独立完成最终回答。
- 路由模型会自动选择上游列表里“价格已知且最便宜”的模型。
- 最终请求只替换 `model`，其他字段尽量保持原样透传。

## 快速开始

安装依赖并启动：

```bash
npm install
npm run build
npm start
```

项目会自动读取根目录下的 `.env` 文件。

最小配置：

```bash
UPSTREAM_BASE_URL=https://your-relay.example.com
UPSTREAM_API_KEY=sk-your-upstream-key
```

可选配置：

```bash
PORT=8787
ROUTER_API_KEY=local-router-key
UPSTREAM_TIMEOUT_MS=30000
AUTO_MAX_ATTEMPTS=2
```

`.env` 已经被 `.gitignore` 忽略，不要提交自己的 Key。

## 像 ccswitch 一样简单吗？

目标上可以做到类似 ccswitch 的体验：用户只需要填一次中转站地址和 Key，然后客户端统一指向本地代理。

当前版本的实际使用步骤是：

1. 填 `.env`
2. 启动本服务
3. 把客户端的 `base_url` 改成 `http://127.0.0.1:8787/v1`
4. 把模型名改成 `auto`、`auto-coding` 或 `auto-longtext`

现在还不是完整的一键工具。要做到更像 ccswitch，下一步应该补：

- `llm-router init`：交互式填写中转站地址和 Key。
- `llm-router start` / `llm-router stop` / `llm-router status`：像本地小工具一样管理服务。
- 一键写入常见客户端配置。
- macOS 后台常驻，开机自动启动。
- 一个全局安装方式，例如 `npm i -g llm-router` 或安装脚本。

底层路由能力已经具备，主要还差安装和配置体验。

## 客户端怎么配置

把客户端配置成 OpenAI-compatible provider：

```bash
base_url=http://127.0.0.1:8787/v1
api_key=任意值
model=auto
```

如果你设置了 `ROUTER_API_KEY`，客户端的 `api_key` 要填这个本地代理 Key。

常用模型名：

```bash
auto
auto-coding
auto-longtext
```

也可以继续使用真实模型 ID。真实模型会直接转发，不走自动路由。

## 接口

健康检查：

```bash
curl http://localhost:8787/health
```

模型列表：

```bash
curl http://localhost:8787/v1/models
```

手动指定真实模型：

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "real-upstream-model-id",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

自动路由：

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Explain how a binary search works."}]
  }'
```

流式自动路由：

```bash
curl -N http://localhost:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "auto-coding",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a tiny TypeScript debounce function."}]
  }'
```

响应会包含这些 header：

- `x-llm-router-request-id`
- `x-llm-router-original-model`
- `x-llm-router-target-model`

## 行为说明

- 支持 `POST /v1/chat/completions`。
- 支持 `stream: true`。流式请求会先做一次非流式路由判断，然后代理上游 SSE。
- 支持 `GET /v1/models`，会返回真实上游模型和虚拟模型。
- 支持 `GET /health`。
- 真实模型 ID 会直接转发，不调用路由模型。
- 未知价格的模型可以作为回答候选，但不能作为“最便宜路由模型”。
- 自动路由遇到 timeout、network error、`429`、`5xx` 会按配置重新路由并重试。
- 流式响应只有在上游还没吐出 chunk 前才能 fallback；一旦已经发给客户端，就不能安全换模型。
- `tools`、`tool_choice`、`parallel_tool_calls`、旧版 `functions`、`function_call` 会透传给最终模型。
- 工具调用和多模态请求会在内部路由 payload 里带上 `required_capabilities`，帮助路由模型避开明显不合适的候选。
- 多模态请求最终会原样转发；但内部路由请求会把 base64 图片、超长 base64 字符串和超长 URL 替换成元数据，避免路由模型上下文被图片 payload 撑爆。
- 流式客户端断开时，会 abort 上游流式请求。
- 错误响应不会泄露上游 API Key。

## 自动路由逻辑

自动路由是两阶段：

1. 路由模型读取原始请求、候选模型列表、价格、能力提示和当前虚拟模式。
2. 路由模型输出结构化 JSON，选择最终 `target_model` 和 `reasoning_effort`。

本地代码只负责校验路由输出、处理 fallback、替换模型名并转发原始请求。正常情况下不会在路由模型之后再硬改业务决策。

路由模型需要返回：

```json
{
  "target_model": "真实模型 ID",
  "task_type": "任务类型",
  "difficulty": "simple|standard|hard",
  "reasoning_effort": "none|low|medium|high|xhigh",
  "confidence": 0.98,
  "reason": "简短理由"
}
```

当前 GPT 风格模型池的默认倾向：

| 任务 | 路由倾向 |
| --- | --- |
| 简单聊天、改写、翻译、短问答 | 选择 `gpt-5.4-mini` 或其他低成本可用模型 |
| 简单代码、小段代码生成、语法帮助、直接 bug 修复 | 选择 `gpt-5.3-codex` |
| 困难 coding、架构规划、repo 级迁移、复杂 debug、PR/安全 review | 选择最强前沿模型，例如 `gpt-5.5`，并使用 `xhigh` |
| 简单长文本抽取或总结 | 选择低成本且长上下文可用的模型 |
| 复杂长文本推理、高风险分析 | 选择最强前沿模型，并使用 `high` 或 `xhigh` |

如果目标模型失败并触发 fallback，下一次路由会把失败目标放进 `excluded_models`，要求路由模型换一个合法候选。

## 价格目录

价格解析顺序：

1. 优先使用上游 `/v1/models` 返回的价格字段。
2. 如果上游没有价格，用本项目内置公开价格 catalog 匹配模型 ID 或 alias。
3. 仍然匹配不到价格的模型可以作为回答候选，但不能作为路由模型。

如果没有任何价格已知的模型，`auto` 会返回 `no_priced_router_model`；手动真实模型仍然可以直接转发。

内置价格 catalog 只是启动便利，不是账单真相。上游价格变化后需要更新本地 catalog。

## 当前不做什么

第一版专注一个 Key 的自动模型选择，暂时不做：

- 官方 Codex-compatible Responses 完整协议。
- Claude App / Anthropic Messages API。
- 多中转站负载均衡。
- SaaS、多租户、管理后台、数据库。
- 图片生成、音频、Realtime。
