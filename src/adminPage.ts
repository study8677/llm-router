export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Router Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1d2430;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #1b6ef3;
      --accent-dark: #1453b8;
      --ok: #107c41;
      --warn: #b45309;
      --danger: #b42318;
      --shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
    .subtitle { margin: 8px 0 0; color: var(--muted); max-width: 680px; }
    .top-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr); gap: 16px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 20px;
    }
    .panel h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    .field { margin: 16px 0; }
    label { display: block; font-weight: 650; margin-bottom: 6px; }
    .hint { color: var(--muted); font-size: 13px; margin-top: 6px; }
    input, select {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      color: var(--text);
      background: #fff;
      font: inherit;
    }
    input:focus, select:focus { outline: 2px solid rgba(27, 110, 243, 0.18); border-color: var(--accent); }
    .segmented {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 8px;
    }
    .segment {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      min-height: 72px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      background: #fff;
    }
    .segment input { width: auto; min-height: auto; margin-top: 3px; }
    .segment strong { display: block; }
    .segment span { color: var(--muted); font-size: 13px; }
    .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
    button, .link-button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 9px 13px;
      min-height: 40px;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.primary:hover { background: var(--accent-dark); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .status {
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #fbfcfe;
      padding: 14px;
      margin-bottom: 12px;
    }
    .status-title { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .status-value { font-size: 18px; font-weight: 700; margin-top: 4px; overflow-wrap: anywhere; }
    .pill { display: inline-flex; border-radius: 999px; padding: 3px 9px; font-size: 12px; background: #eef4ff; color: #1849a9; }
    .pill.ok { background: #ecfdf3; color: var(--ok); }
    .pill.warn { background: #fffaeb; color: var(--warn); }
    .message { min-height: 22px; margin-top: 10px; font-weight: 600; }
    .message.ok { color: var(--ok); }
    .message.error { color: var(--danger); }
    .models { margin-top: 16px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    .model-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 10px 12px;
      border-top: 1px solid var(--line);
      align-items: center;
    }
    .model-row:first-child { border-top: 0; }
    .model-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .price { color: var(--muted); font-size: 12px; text-align: right; }
    @media (max-width: 840px) {
      header { display: block; }
      .top-actions { justify-content: flex-start; margin-top: 14px; }
      .grid { grid-template-columns: 1fr; }
      .segmented { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>LLM Router Admin</h1>
        <p class="subtitle">配置本地 auto 路由行为。默认使用最便宜的已知价格模型做路由，也可以手动指定一个上游模型。</p>
      </div>
      <div class="top-actions">
        <a class="link-button" href="/v1/models" target="_blank" rel="noreferrer">Models</a>
        <a class="link-button" href="/health" target="_blank" rel="noreferrer">Health</a>
      </div>
    </header>

    <section class="grid">
      <div class="panel">
        <h2>Auto 路由模型</h2>
        <div class="field" id="apiKeyField" hidden>
          <label for="apiKey">Router API Key</label>
          <input id="apiKey" type="password" autocomplete="off" placeholder="ROUTER_API_KEY">
          <div class="hint">当前服务开启了入口保护。Key 只保存在此浏览器的 localStorage。</div>
        </div>

        <div class="field">
          <label>选择方式</label>
          <div class="segmented">
            <label class="segment">
              <input type="radio" name="mode" value="automatic" checked>
              <span><strong>自动选择</strong><span>使用价格已知且最便宜的模型做路由。</span></span>
            </label>
            <label class="segment">
              <input type="radio" name="mode" value="manual">
              <span><strong>手动指定</strong><span>固定使用下面选择的模型做路由。</span></span>
            </label>
          </div>
        </div>

        <div class="field">
          <label for="routerModel">路由模型</label>
          <select id="routerModel"></select>
          <div class="hint">路由模型只输出 JSON 决策，不直接回答用户。最终回答仍会单独调用目标模型。</div>
        </div>

        <div class="actions">
          <button class="primary" id="saveButton" type="button">保存配置</button>
          <button id="refreshButton" type="button">刷新</button>
          <span id="modePill" class="pill">loading</span>
        </div>
        <div id="message" class="message"></div>
      </div>

      <aside class="panel">
        <h2>当前状态</h2>
        <div class="status">
          <div class="status-title">生效路由模型</div>
          <div id="effectiveModel" class="status-value">-</div>
        </div>
        <div class="status">
          <div class="status-title">自动候选</div>
          <div id="automaticModel" class="status-value">-</div>
        </div>
        <div class="status">
          <div class="status-title">模型数量</div>
          <div id="modelCount" class="status-value">-</div>
        </div>
      </aside>
    </section>

    <section class="panel" style="margin-top:16px">
      <h2>上游模型</h2>
      <div id="models" class="models"></div>
    </section>
  </main>

  <script>
    const state = { models: [], config: null };
    const apiKeyInput = document.getElementById("apiKey");
    const apiKeyField = document.getElementById("apiKeyField");
    const routerModelSelect = document.getElementById("routerModel");
    const message = document.getElementById("message");
    const modePill = document.getElementById("modePill");

    apiKeyInput.value = localStorage.getItem("llm-router-admin-key") || "";
    document.getElementById("saveButton").addEventListener("click", saveConfig);
    document.getElementById("refreshButton").addEventListener("click", loadConfig);
    apiKeyInput.addEventListener("change", () => {
      localStorage.setItem("llm-router-admin-key", apiKeyInput.value);
      loadConfig();
    });

    function headers() {
      const key = apiKeyInput.value.trim();
      return key ? { authorization: "Bearer " + key, "content-type": "application/json" } : { "content-type": "application/json" };
    }

    async function loadConfig() {
      setMessage("", "");
      const response = await fetch("/admin/config", { headers: headers() });
      if (response.status === 401) {
        apiKeyField.hidden = false;
        setMessage("需要填写 ROUTER_API_KEY 才能读取配置。", "error");
        return;
      }
      if (!response.ok) {
        setMessage("读取配置失败：" + response.status, "error");
        return;
      }
      apiKeyField.hidden = true;
      state.config = await response.json();
      state.models = state.config.models || [];
      render();
    }

    async function saveConfig() {
      const mode = document.querySelector('input[name="mode"]:checked').value;
      const routerModelId = mode === "manual" ? routerModelSelect.value : null;
      const response = await fetch("/admin/config", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ router_model_id: routerModelId })
      });
      if (response.status === 401) {
        apiKeyField.hidden = false;
        setMessage("保存失败：ROUTER_API_KEY 不正确。", "error");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage("保存失败：" + (body.error?.message || response.status), "error");
        return;
      }
      state.config = await response.json();
      state.models = state.config.models || [];
      render();
      setMessage("已保存。新的 auto 请求会立即使用该配置。", "ok");
    }

    function render() {
      const config = state.config;
      const manual = config.router_model_mode === "manual";
      document.querySelector('input[value="' + (manual ? "manual" : "automatic") + '"]').checked = true;
      routerModelSelect.innerHTML = "";
      for (const model of state.models) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.id + (model.price ? " · $" + model.price.input_usd_per_1m_tokens + "/" + model.price.output_usd_per_1m_tokens : " · price unknown");
        routerModelSelect.appendChild(option);
      }
      routerModelSelect.value = config.router_model_id || config.automatic_router_model_id || state.models[0]?.id || "";
      document.getElementById("effectiveModel").textContent = config.effective_router_model_id || "-";
      document.getElementById("automaticModel").textContent = config.automatic_router_model_id || "-";
      document.getElementById("modelCount").textContent = String(state.models.length);
      modePill.textContent = manual ? "manual" : "automatic";
      modePill.className = "pill " + (manual ? "warn" : "ok");
      if (config.router_model_id && !config.configured_router_model_available) {
        setMessage("当前手动路由模型已不在上游模型列表中，请重新选择。", "error");
      }
      renderModels();
    }

    function renderModels() {
      const box = document.getElementById("models");
      box.innerHTML = "";
      for (const model of state.models) {
        const row = document.createElement("div");
        row.className = "model-row";
        const id = document.createElement("div");
        id.className = "model-id";
        id.textContent = model.id;
        const price = document.createElement("div");
        price.className = "price";
        price.textContent = model.price ? "$" + model.price.input_usd_per_1m_tokens + " in / $" + model.price.output_usd_per_1m_tokens + " out" : "price unknown";
        row.append(id, price);
        box.appendChild(row);
      }
    }

    function setMessage(text, type) {
      message.textContent = text;
      message.className = "message " + type;
    }

    loadConfig().catch((error) => setMessage(String(error), "error"));
  </script>
</body>
</html>`;
}
