import * as api from "../api";
import { h, btn, input, textarea, field, pill, mono, emptyState, fmtDate, maskKey, copyToClipboard } from "../components/ui";
import { showModal, hideModal, modalCard } from "../components/modal";

let currentTab: "tools" | "api-keys" | "configuration" = "tools";
let toolAccess: api.ToolAccess | null = null;

export async function renderServiceDetail(root: HTMLElement, project: api.Project, service: api.McpService) {
  root.innerHTML = "";
  const container = h("div", { className: "p-6 max-w-[900px]" });

  // ── Service Header ──
  const header = h("div", { className: "mb-5" });
  const title = h("h1", { className: "text-xl font-semibold mb-1" }, service.name);
  header.appendChild(title);

  const meta = h("div", { className: "flex items-center gap-3 text-xs text-text-2" });
  meta.appendChild(pill(service.status === "active" ? "Active" : "Planned", service.status === "active" ? "ok" : "neutral"));
  meta.appendChild(h("span", {}, service.description));
  header.appendChild(meta);

  // Endpoint
  api.getDomain().then((domain) => {
    if (domain) {
      const endpoint = h("div", { className: "mt-1.5 font-mono text-[11px] text-text-3" }, `${service.id}.${domain}/mcp`);
      header.appendChild(endpoint);
    }
  });
  container.appendChild(header);

  // ── Quick Setup ──
  const setup = h("div", { className: "bg-accent-soft/60 border border-accent/20 rounded-lg p-4 mb-6" });

  const setupLabel = h("div", { className: "text-[10.5px] font-semibold text-accent uppercase tracking-wider mb-3 flex items-center gap-1.5" });
  setupLabel.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
  setupLabel.appendChild(document.createTextNode(" Quick Setup"));
  setup.appendChild(setupLabel);

  const domain = await api.getDomain();

  // Claude Code CLI
  const codeLabel = h("div", { className: "text-[10px] font-medium text-text-2 uppercase tracking-wider mb-1.5" }, "Claude Code (CLI)");
  setup.appendChild(codeLabel);

  const codeCmd = `claude mcp add --transport http -H "Authorization: Bearer <your-key>" ${service.id} https://${service.id}.${domain}/mcp`;
  const codeBox = h("div", { className: "bg-surface-0 border border-edge rounded-md p-3 font-mono text-[11px] text-accent break-all leading-relaxed relative mb-4" });
  codeBox.appendChild(document.createTextNode(codeCmd));
  const codeCopy = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(codeCmd, codeCopy) });
  codeCopy.className += " absolute top-2 right-2";
  codeBox.appendChild(codeCopy);
  setup.appendChild(codeBox);

  // Claude.ai
  const aiLabel = h("div", { className: "text-[10px] font-medium text-text-2 uppercase tracking-wider mb-1.5" }, "Claude.ai (Web)");
  setup.appendChild(aiLabel);

  const aiSteps = h("div", { className: "bg-surface-0 border border-edge rounded-md p-3 text-[11.5px] text-text-1 leading-relaxed" });
  const aiUrl = `https://${service.id}.${domain}/mcp`;
  aiSteps.innerHTML = `
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline gap-2">
        <span class="text-text-3 font-medium shrink-0">1.</span>
        <span>Go to <strong>Settings → MCP Servers → Add</strong> in Claude.ai</span>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-text-3 font-medium shrink-0">2.</span>
        <span>Enter URL: <code class="font-mono text-accent bg-surface-3 px-1.5 py-0.5 rounded text-[10.5px]">${aiUrl}</code>
          <button class="ml-1 text-[10px] text-text-3 hover:text-accent transition-colors" id="copy-ai-url">copy</button>
        </span>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="text-text-3 font-medium shrink-0">3.</span>
        <span>Sign in when prompted — authentication is handled automatically via OAuth</span>
      </div>
    </div>
  `;
  setup.appendChild(aiSteps);

  container.appendChild(setup);

  // Bind copy button for AI URL
  setTimeout(() => {
    const copyAiBtn = document.getElementById("copy-ai-url");
    if (copyAiBtn) {
      copyAiBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(aiUrl);
        copyAiBtn.textContent = "copied!";
        setTimeout(() => { copyAiBtn.textContent = "copy"; }, 2000);
      });
    }
  }, 0);

  // ── Tabs ──
  const tabs = h("div", { className: "flex gap-0.5 mb-4" });
  const tabDefs: { id: typeof currentTab; label: string }[] = [
    { id: "tools", label: "Tools" },
    { id: "api-keys", label: "API Keys" },
    { id: "configuration", label: "Configuration" },
  ];
  for (const tab of tabDefs) {
    const tabBtn = h("button", {
      className: `px-4 py-2 rounded-md text-xs transition-all font-[family-name:var(--font-sans)] ${
        currentTab === tab.id
          ? "bg-accent-soft text-accent font-medium"
          : "text-text-2 hover:bg-surface-3 hover:text-text-1"
      }`,
    }, tab.label);
    tabBtn.addEventListener("click", () => {
      currentTab = tab.id;
      renderServiceDetail(root, project, service);
    });
    tabs.appendChild(tabBtn);
  }
  container.appendChild(tabs);

  // ── Tab Content ──
  if (currentTab === "tools") {
    await renderToolsTab(container, service);
  } else if (currentTab === "api-keys") {
    await renderKeysTab(container, project, service);
  } else {
    await renderConfigTab(container, project, service);
  }

  root.appendChild(container);
}

async function renderToolsTab(container: HTMLElement, service: api.McpService) {
  if (!service.tools || service.tools.length === 0) {
    container.appendChild(emptyState("No tools registered for this service."));
    return;
  }

  // Fetch ACL access
  const toolNames = service.tools.map((t) => {
    const name = t.split(" — ")[0]?.split(" ")[0] || t;
    return name;
  });

  try {
    toolAccess = await api.acl.checkTools(service.id, toolNames);
  } catch {
    toolAccess = null; // ACL not configured or error — show all as allowed
  }

  const countLabel = h("div", { className: "text-xs text-text-3 mb-3" },
    `${service.tools.length} tools available`);
  container.appendChild(countLabel);

  const list = h("div", { className: "flex flex-col gap-1" });
  for (const tool of service.tools) {
    const parts = tool.split(" — ");
    const name = parts[0] || tool;
    const desc = parts[1] || "";
    const toolKey = name.split(" ")[0];

    const isAllowed = !toolAccess || toolAccess[toolKey]?.allowed !== false;
    const reason = toolAccess?.[toolKey]?.reason;

    const item = h("div", {
      className: `flex items-baseline gap-2.5 px-3 py-2.5 rounded-md ${
        isAllowed ? "bg-surface-2" : "bg-surface-2/50 opacity-50"
      }`,
    });

    const nameEl = h("span", {
      className: `font-mono text-[12px] font-medium whitespace-nowrap ${isAllowed ? "text-accent" : "text-text-3 line-through"}`,
    }, name);
    item.appendChild(nameEl);

    if (desc) {
      item.appendChild(h("span", { className: "text-text-3 text-[11px]" }, "\u2014"));
      item.appendChild(h("span", { className: `text-[12px] ${isAllowed ? "text-text-2" : "text-text-3"}` }, desc));
    }

    if (!isAllowed) {
      const badge = h("span", {
        className: "ml-auto text-[9.5px] font-medium text-danger bg-danger-soft px-2 py-0.5 rounded-full shrink-0",
      }, reason || "Restricted");
      item.appendChild(badge);
    }

    list.appendChild(item);
  }
  container.appendChild(list);
}

async function renderKeysTab(container: HTMLElement, project: api.Project, service: api.McpService) {
  if (service.status !== "active") {
    container.appendChild(emptyState("This service is not yet active"));
    return;
  }

  let serviceKeys: api.McpKey[] = [];
  try {
    serviceKeys = await api.keys.list(project.id, service.id);
  } catch { /* no keys */ }

  const bar = h("div", { className: "flex justify-between items-center mb-3" });
  bar.appendChild(h("span", { className: "text-xs text-text-3" }, `${serviceKeys.length} key${serviceKeys.length !== 1 ? "s" : ""}`));
  bar.appendChild(btn("+ New Key", { onClick: () => showCreateKeyModal(container, project, service) }));
  container.appendChild(bar);

  if (serviceKeys.length === 0) {
    container.appendChild(emptyState(`No API keys for ${service.name}. Create one to get started.`));
    return;
  }

  const table = document.createElement("table");
  table.className = "w-full border-collapse bg-surface-2 border border-edge rounded-lg overflow-hidden";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of ["Name", "Key", "Created By", "Created", ""]) {
    const th = document.createElement("th");
    th.className = "text-left px-4 py-2.5 text-[10px] font-medium text-text-3 uppercase tracking-wider bg-surface-3 border-b border-edge";
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const key of serviceKeys) {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-accent-soft/30";

    const cells = [
      { text: key.name, className: "font-medium" },
      { el: mono(maskKey(key.key_id)) },
      { text: key.created_by, className: "text-text-3" },
      { text: fmtDate(key.created_at), className: "text-text-3" },
    ];

    for (const cell of cells) {
      const td = document.createElement("td");
      td.className = "px-4 py-3 text-[12px] border-b border-edge text-text-1 " + (cell.className || "");
      if (cell.el) td.appendChild(cell.el);
      else td.textContent = cell.text || "";
      tr.appendChild(td);
    }

    const actionTd = document.createElement("td");
    actionTd.className = "px-4 py-3 text-right border-b border-edge";
    actionTd.appendChild(
      btn("Delete", {
        variant: "danger",
        size: "sm",
        onClick: async () => {
          if (!confirm(`Delete key "${key.name}"? This cannot be undone.`)) return;
          await api.keys.delete(project.id, service.id, key.key_id);
          const root = container.closest("#main-content")! as HTMLElement;
          renderServiceDetail(root, project, service);
        },
      }),
    );
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

async function renderConfigTab(container: HTMLElement, project: api.Project, service: api.McpService) {
  if (!service.credentialsSchema || service.credentialsSchema.length === 0) {
    container.appendChild(emptyState(`${service.name} does not require any configuration.`));
    return;
  }

  let meta: api.CredentialMeta = { has_credentials: false, updated_at: null, updated_by: null };
  try {
    meta = await api.credentials.get(project.id, service.id);
  } catch { /* no credentials */ }

  // Status line
  if (meta.has_credentials) {
    const statusLine = h("div", { className: "flex items-center gap-2 mb-4" },
      pill("Configured", "ok"),
      h("span", { className: "text-[11px] text-text-3" }, `Updated ${fmtDate(meta.updated_at)} by ${meta.updated_by || "unknown"}`),
    );
    container.appendChild(statusLine);
  }

  // Explainer
  const hasRequired = service.credentialsSchema.some((f) => f.required);
  const explainerText = hasRequired
    ? `These settings are shared across all API keys in this project.`
    : `Optional settings shared across all API keys in this project.`;
  container.appendChild(h("div", { className: "text-xs text-text-2 mb-4" }, explainerText));

  // Inline form
  const form = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-5" });
  const inputs: { key: string; input: HTMLInputElement | HTMLTextAreaElement }[] = [];

  for (const f of service.credentialsSchema) {
    const inp = f.type === "textarea"
      ? textarea({ placeholder: meta.has_credentials ? "\u2022\u2022\u2022\u2022\u2022\u2022 (leave blank to keep current)" : f.label, rows: 3 })
      : input({ placeholder: meta.has_credentials ? "\u2022\u2022\u2022\u2022\u2022\u2022 (leave blank to keep current)" : f.label, type: "password" });
    inputs.push({ key: f.key, input: inp });

    const label = f.label + (f.required ? "" : " (optional)");
    form.appendChild(field(label, inp, f.hint));
  }

  // Actions
  const actions = h("div", { className: "flex items-center gap-2 pt-1" });

  const saveBtn = btn("Save", {
    onClick: async () => {
      const creds: Record<string, string> = {};
      for (const { key, input: inp } of inputs) {
        const val = inp.value.trim();
        if (val) creds[key] = val;
      }
      if (Object.keys(creds).length === 0 && !meta.has_credentials) return;
      try {
        await api.credentials.set(project.id, service.id, creds);
        const root = container.closest("#main-content")! as HTMLElement;
        import("../main").then(({ getState }) => {
          const { currentProject, currentService } = getState();
          if (currentProject && currentService) renderServiceDetail(root, currentProject, currentService);
        });
      } catch (e) {
        alert((e as Error).message);
      }
    },
  });
  actions.appendChild(saveBtn);

  if (meta.has_credentials) {
    actions.appendChild(btn("Remove", {
      variant: "danger",
      onClick: async () => {
        if (!confirm("Remove configuration? API keys will lose access to this service.")) return;
        await api.credentials.remove(project.id, service.id);
        const root = container.closest("#main-content")! as HTMLElement;
        renderServiceDetail(root, project, service);
      },
    }));
  }

  form.appendChild(actions);
  container.appendChild(form);
}

// ── Modals ──

function showCreateKeyModal(container: HTMLElement, project: api.Project, service: api.McpService) {
  const nameInput = input({ placeholder: "e.g. laptop, ci-pipeline" });
  const body = field("Key Name", nameInput);

  const footer = h("div", { className: "flex justify-end gap-2 mt-1" });
  footer.appendChild(btn("Cancel", { variant: "outline", onClick: hideModal }));
  footer.appendChild(btn("Create", {
    onClick: async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const created = await api.keys.create(project.id, service.id, name);
      hideModal();
      showKeyCreatedModal(container, created, service);
    },
  }));

  showModal(modalCard({ title: `New ${service.name} API Key`, description: `Create a key scoped to ${project.name} / ${service.name}.`, body, footer }));
}

async function showKeyCreatedModal(container: HTMLElement, created: api.CreatedKey, service: api.McpService) {
  const body = h("div", {});

  const warn = h("div", { className: "bg-warn-soft border border-warn/12 rounded-md px-3 py-2.5 text-[11.5px] text-warn mb-4 flex items-center gap-2" });
  warn.textContent = "Copy now \u2014 the key won't be shown again.";
  body.appendChild(warn);

  const keyBox = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 font-mono text-[11.5px] text-accent break-all leading-relaxed relative mb-3" });
  const keyLabel = h("span", { className: "font-sans text-[9.5px] text-text-3 uppercase tracking-wider block mb-1" }, "API Key");
  keyBox.appendChild(keyLabel);
  keyBox.appendChild(h("span", {}, created.key));
  const copyBtn = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(created.key, copyBtn) });
  copyBtn.className += " absolute top-2.5 right-2.5";
  keyBox.appendChild(copyBtn);
  body.appendChild(keyBox);

  // CLI command
  const domain = await api.getDomain();
  const cliCmd = `claude mcp add --transport http -H "Authorization: Bearer ${created.key}" ${service.id} https://${service.id}.${domain}/mcp`;
  const cliLabel = h("div", { className: "text-[10px] font-medium text-text-3 uppercase tracking-wider mb-1.5" }, "Claude Code (CLI)");
  body.appendChild(cliLabel);
  const cliBox = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 font-mono text-[11px] text-accent break-all leading-relaxed relative" });
  cliBox.appendChild(h("span", {}, cliCmd));
  const cliCopy = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(cliCmd, cliCopy) });
  cliCopy.className += " absolute top-2.5 right-2.5";
  cliBox.appendChild(cliCopy);
  body.appendChild(cliBox);

  const footer = h("div", { className: "flex justify-end mt-3" });
  footer.appendChild(btn("Done", {
    onClick: () => {
      hideModal();
      const root = container.closest("#main-content")! as HTMLElement;
      import("../main").then(({ getState }) => {
        const { currentProject, currentService } = getState();
        if (currentProject && currentService) renderServiceDetail(root, currentProject, currentService);
      });
    },
  }));

  showModal(modalCard({ title: "Key Created", body, footer }));
}

