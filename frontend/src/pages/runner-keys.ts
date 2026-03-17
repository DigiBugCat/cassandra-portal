import * as api from "../api";
import { h, btn, input, field, mono, pill, emptyState, fmtDate, copyToClipboard } from "../components/ui";
import { showModal, hideModal, modalCard } from "../components/modal";

export async function renderRunnerDetail(root: HTMLElement) {
  root.innerHTML = "";
  const container = h("div", { className: "p-6 max-w-[900px]" });

  // ── Header ──
  const header = h("div", { className: "mb-5" });
  header.appendChild(h("h1", { className: "text-xl font-semibold mb-1" }, "Agent Runner"));
  const meta = h("div", { className: "flex items-center gap-3 text-xs text-text-2" });
  meta.appendChild(pill("Active", "ok"));
  meta.appendChild(h("span", {}, "Claude Code Agent Runner — isolated sessions in k8s pods"));
  header.appendChild(meta);

  api.getDomain().then((domain) => {
    if (domain) {
      header.appendChild(h("div", { className: "mt-1.5 font-mono text-[11px] text-text-3" }, `claude-runner.${domain}`));
    }
  });
  container.appendChild(header);

  // ── Tenant Keys ──
  const keysSection = h("div", {});
  const sectionTitle = h("div", { className: "text-[11px] font-semibold text-text-3 uppercase tracking-wider mb-3 pb-2 border-b border-edge" }, "Tenant Keys");
  keysSection.appendChild(sectionTitle);

  let tokens: api.RunnerToken[] = [];
  try {
    tokens = await api.runnerTokens.list();
  } catch (e) {
    const errCard = h("div", { className: "bg-danger-soft border border-danger/20 rounded-lg p-4 text-[12.5px] text-danger" },
      `Runner unavailable: ${(e as Error).message}`);
    keysSection.appendChild(errCard);
    container.appendChild(keysSection);
    root.appendChild(container);
    return;
  }

  // Bar
  const bar = h("div", { className: "flex justify-between items-center mb-3" });
  bar.appendChild(h("span", { className: "text-xs text-text-3" },
    `${tokens.length} tenant${tokens.length !== 1 ? "s" : ""}`,
  ));
  bar.appendChild(btn("+ New Tenant", { onClick: () => showCreateRunnerModal(root) }));
  keysSection.appendChild(bar);

  if (tokens.length === 0) {
    keysSection.appendChild(emptyState("No tenants yet. Create one to get started."));
    container.appendChild(keysSection);
    root.appendChild(container);
    return;
  }

  // Table
  const table = document.createElement("table");
  table.className = "w-full border-collapse bg-surface-2 border border-edge rounded-lg overflow-hidden";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of ["Name", "Email", "Namespace", "Max Sessions", "Created", ""]) {
    const th = document.createElement("th");
    th.className = "text-left px-4 py-2.5 text-[10px] font-medium text-text-3 uppercase tracking-wider bg-surface-3 border-b border-edge";
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const t of tokens) {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-accent-soft/30";

    const cells = [
      { text: t.name, className: "font-medium" },
      { text: t.email || "—", className: "text-text-3" },
      { el: mono(t.namespace) },
      { text: String(t.max_sessions) },
      { text: fmtDate(t.created_at), className: "text-text-3" },
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
    const actions = h("div", { className: "flex justify-end gap-2" });
    actions.appendChild(
      btn("Rotate Key", {
        variant: "outline",
        size: "sm",
        onClick: async () => {
          if (!confirm(`Rotate API key for "${t.name}"? The old key will stop working immediately.`)) return;
          try {
            const result = await api.runnerTokens.rotateKey(t.id);
            showRotatedKeyModal(root, t.name, result.api_key);
          } catch (e) {
            alert((e as Error).message);
          }
        },
      }),
    );
    actions.appendChild(
      btn("Delete", {
        variant: "danger",
        size: "sm",
        onClick: async () => {
          if (!confirm(`Delete tenant "${t.name}"?`)) return;
          await api.runnerTokens.delete(t.id);
          renderRunnerDetail(root);
        },
      }),
    );
    actionTd.appendChild(actions);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  keysSection.appendChild(table);

  container.appendChild(keysSection);

  // ── Configuration (Obsidian Vault Sync) ──
  await renderRunnerConfig(container, root);

  root.appendChild(container);
}

async function renderRunnerConfig(container: HTMLElement, root: HTMLElement) {
  const section = h("div", { className: "mt-8" });
  const sectionTitle = h("div", { className: "text-[11px] font-semibold text-text-3 uppercase tracking-wider mb-3 pb-2 border-b border-edge" }, "Obsidian Vault Sync");
  section.appendChild(sectionTitle);

  let config: api.RunnerConfigMeta;
  try {
    config = await api.runnerConfig.get();
  } catch {
    section.appendChild(h("div", { className: "text-xs text-text-3" }, "Failed to load configuration."));
    container.appendChild(section);
    return;
  }

  section.appendChild(h("div", { className: "text-xs text-text-2 mb-4" }, "Obsidian account token and per-vault E2EE passwords. Encrypted at rest, fetched per-session by the runner."));

  // ── Auth Token (account-level) ──
  const authBox = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-5 mb-4" });
  authBox.appendChild(h("div", { className: "text-[11px] font-semibold text-text-2 mb-1" }, "Obsidian Auth Token"));
  authBox.appendChild(h("div", { className: "text-[11px] text-text-3 mb-3" }, "Account-level token shared across all vaults."));

  if (config.auth_token.configured) {
    const statusLine = h("div", { className: "flex items-center gap-2 mb-3" },
      pill("Configured", "ok"),
      h("span", { className: "text-[11px] text-text-3" }, `Updated ${fmtDate(config.auth_token.updated_at)}`),
    );
    authBox.appendChild(statusLine);
  }

  const tokenInput = input({
    placeholder: config.auth_token.configured ? "\u2022\u2022\u2022\u2022\u2022\u2022 (leave blank to keep current)" : "Obsidian auth token",
    type: "password",
  });
  authBox.appendChild(tokenInput);

  const authActions = h("div", { className: "flex items-center gap-2 mt-3" });
  authActions.appendChild(btn("Save", {
    onClick: async () => {
      const val = tokenInput.value.trim();
      if (!val && !config.auth_token.configured) return;
      if (!val) return; // nothing to update
      try {
        await api.runnerConfig.setAuth(val);
        renderRunnerDetail(root);
      } catch (e) { alert((e as Error).message); }
    },
  }));
  if (config.auth_token.configured) {
    authActions.appendChild(btn("Remove", {
      variant: "danger",
      onClick: async () => {
        if (!confirm("Remove auth token? Vault sync will stop working for all vaults.")) return;
        await api.runnerConfig.removeAuth();
        renderRunnerDetail(root);
      },
    }));
  }
  authBox.appendChild(authActions);
  section.appendChild(authBox);

  // ── Vaults (per-vault E2EE passwords) ──
  const vaultsBox = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-5" });
  vaultsBox.appendChild(h("div", { className: "text-[11px] font-semibold text-text-2 mb-1" }, "Vault E2EE Passwords"));
  vaultsBox.appendChild(h("div", { className: "text-[11px] text-text-3 mb-3" }, "Each vault can have its own end-to-end encryption password."));

  // Existing vaults
  if (config.vaults.length > 0) {
    const list = h("div", { className: "flex flex-col gap-2 mb-4" });
    for (const v of config.vaults) {
      const row = h("div", { className: "flex items-center gap-3 px-3 py-2.5 bg-surface-3 rounded-md" });
      row.appendChild(h("span", { className: "font-mono text-[12px] text-text-1 font-medium" }, v.vault));
      row.appendChild(h("span", { className: "text-[10px] text-text-3 ml-auto" }, fmtDate(v.updated_at)));
      row.appendChild(btn("Remove", {
        variant: "danger",
        size: "sm",
        onClick: async () => {
          if (!confirm(`Remove E2EE password for vault "${v.vault}"?`)) return;
          await api.runnerConfig.removeVault(v.vault);
          renderRunnerDetail(root);
        },
      }));
      list.appendChild(row);
    }
    vaultsBox.appendChild(list);
  }

  // Add vault form — dropdown populated from Obsidian API
  if (config.auth_token.configured) {
    // Use CSS grid for guaranteed equal-width columns + auto button
    const addForm = document.createElement("div");
    addForm.style.display = "grid";
    addForm.style.gridTemplateColumns = "1fr 1fr auto";
    addForm.style.gap = "8px";
    addForm.style.alignItems = "end";

    const baseCls = "w-full px-3 bg-surface-3 border border-edge rounded-md text-[12.5px] text-text-0 outline-hidden focus:border-accent font-[family-name:var(--font-sans)]";
    const labelCls = "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-1.5";
    const fixedH = "38px"; // shared inline height — bulletproof across input/select

    // Vault column
    const vaultCol = h("div", {});
    vaultCol.appendChild(h("div", { className: labelCls }, "Vault"));
    const vaultSelect = document.createElement("select");
    vaultSelect.className = baseCls;
    vaultSelect.style.height = fixedH;
    vaultSelect.appendChild(h("option", { value: "" }, "Loading vaults..."));
    vaultSelect.disabled = true;
    vaultCol.appendChild(vaultSelect);
    addForm.appendChild(vaultCol);

    // Fetch vaults from Obsidian API
    const configuredVaultNames = new Set(config.vaults.map((v) => v.vault));
    api.runnerConfig.listVaults().then(({ vaults }) => {
      vaultSelect.innerHTML = "";
      const available = vaults.filter((v) => !configuredVaultNames.has(v.name));
      if (available.length === 0) {
        vaultSelect.appendChild(h("option", { value: "" }, "All vaults configured"));
      } else {
        vaultSelect.appendChild(h("option", { value: "" }, "Select a vault..."));
        for (const v of available) {
          vaultSelect.appendChild(h("option", { value: v.name }, v.name));
        }
        vaultSelect.disabled = false;
      }
    }).catch(() => {
      vaultSelect.innerHTML = "";
      vaultSelect.appendChild(h("option", { value: "" }, "Failed to load vaults"));
    });

    // Password column
    const passCol = h("div", {});
    passCol.appendChild(h("div", { className: labelCls }, "E2EE Password"));
    const vaultPassInput = input({ placeholder: "E2EE password", type: "password" });
    vaultPassInput.className = baseCls;
    vaultPassInput.style.height = fixedH;
    passCol.appendChild(vaultPassInput);
    addForm.appendChild(passCol);

    // Button column — invisible label spacer for alignment
    const btnCol = h("div", {});
    btnCol.appendChild(h("div", { className: `${labelCls} invisible` }, "\u00A0"));
    btnCol.appendChild(
      btn("Add Vault", {
        onClick: async () => {
          const name = vaultSelect.value;
          const pass = vaultPassInput.value.trim();
          if (!name || !pass) return;
          try {
            await api.runnerConfig.setVault(name, pass);
            renderRunnerDetail(root);
          } catch (e) { alert((e as Error).message); }
        },
      }),
    );
    addForm.appendChild(btnCol);
    vaultsBox.appendChild(addForm);
  } else {
    vaultsBox.appendChild(h("div", { className: "text-[11px] text-text-3 italic" }, "Set the auth token above to see available vaults."));
  }

  section.appendChild(vaultsBox);
  container.appendChild(section);

  // ── MCP Servers (per-vault) ──
  await renderMcpServersSection(container, config, root);
}

// ── MCP Server Management (per-vault) ──

let mcpExpandedVault: string | null = null;
let mcpShowAddForm = false;

async function renderMcpServersSection(container: HTMLElement, config: api.RunnerConfigMeta, root: HTMLElement) {
  const section = h("div", { className: "mt-8" });
  section.appendChild(h("div", { className: "text-[11px] font-semibold text-text-3 uppercase tracking-wider mb-3 pb-2 border-b border-edge" }, "MCP Servers"));
  section.appendChild(h("div", { className: "text-xs text-text-2 mb-4" }, "Per-vault MCP server configuration. HTTP/SSE servers injected into runner sessions."));

  if (config.vaults.length === 0) {
    section.appendChild(h("div", { className: "text-[11px] text-text-3 italic" }, "Configure vaults above first."));
    container.appendChild(section);
    return;
  }

  // Load MCP config for all vaults in parallel
  const vaultMcpData: Record<string, Record<string, any>> = {};
  await Promise.all(config.vaults.map(async (v) => {
    try {
      const result = await api.runnerConfig.getVaultMcp(v.vault);
      vaultMcpData[v.vault] = result.mcpServers || {};
    } catch {
      vaultMcpData[v.vault] = {};
    }
  }));

  const list = h("div", { className: "flex flex-col border border-edge rounded-lg overflow-hidden" });

  for (const v of config.vaults) {
    const servers = vaultMcpData[v.vault] || {};
    const serverCount = Object.keys(servers).length;
    const isExpanded = mcpExpandedVault === v.vault;

    // Row
    const row = h("div", {
      className: `flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-edge ${
        isExpanded ? "bg-surface-1 border-b-transparent" : "bg-surface-2 hover:bg-surface-3 last:border-b-transparent"
      }`,
    });
    row.appendChild(h("span", { className: "font-mono text-[11.5px] font-medium min-w-[160px]" }, v.vault));

    if (serverCount > 0) {
      const serverPills = h("div", { className: "flex gap-1 flex-wrap flex-1" });
      for (const name of Object.keys(servers)) {
        const srv = servers[name];
        const pillEl = h("span", {
          className: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-soft text-accent",
        });
        pillEl.appendChild(h("span", { className: "font-mono" }, name));
        pillEl.appendChild(h("span", { className: "text-accent/60" }, srv.type || "http"));
        serverPills.appendChild(pillEl);
      }
      row.appendChild(serverPills);
    } else {
      row.appendChild(h("span", { className: "text-[11px] text-text-3 flex-1" }, "No servers configured"));
    }

    row.appendChild(h("span", { className: `text-text-3 transition-transform text-base ${isExpanded ? "rotate-90" : ""}` }, "\u203A"));
    row.addEventListener("click", () => {
      mcpExpandedVault = isExpanded ? null : v.vault;
      mcpShowAddForm = false;
      renderRunnerDetail(root);
    });
    list.appendChild(row);

    // Expanded panel
    if (isExpanded) {
      list.appendChild(buildMcpEditPanel(root, v.vault, servers));
    }
  }

  section.appendChild(list);
  container.appendChild(section);
}

function buildMcpEditPanel(root: HTMLElement, vaultName: string, servers: Record<string, any>): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  const serverNames = Object.keys(servers);

  // Existing servers
  if (serverNames.length > 0) {
    for (const name of serverNames) {
      const srv = servers[name];
      const serverRow = h("div", { className: "flex items-center gap-2.5 px-3 py-2.5 bg-surface-3 rounded-md mb-2" });

      serverRow.appendChild(h("span", { className: "font-mono text-[11.5px] text-accent font-medium" }, name));

      serverRow.appendChild(h("span", {
        className: "text-[9.5px] font-medium text-text-3 bg-surface-4 px-1.5 py-0.5 rounded",
      }, srv.type || "http"));

      serverRow.appendChild(h("span", { className: "font-mono text-[10.5px] text-text-3 truncate flex-1" }, srv.url || ""));

      if (srv.headers && Object.keys(srv.headers).length > 0) {
        serverRow.appendChild(h("span", {
          className: "text-[9.5px] text-text-3 bg-surface-4 px-1.5 py-0.5 rounded",
        }, `${Object.keys(srv.headers).length} header${Object.keys(srv.headers).length !== 1 ? "s" : ""}`));
      }

      serverRow.appendChild(btn("Remove", {
        variant: "danger",
        size: "sm",
        onClick: async () => {
          if (!confirm(`Remove MCP server "${name}" from vault "${vaultName}"?`)) return;
          const updated = { ...servers };
          delete updated[name];
          if (Object.keys(updated).length === 0) {
            await api.runnerConfig.removeVaultMcp(vaultName);
          } else {
            await api.runnerConfig.setVaultMcp(vaultName, updated);
          }
          renderRunnerDetail(root);
        },
      }));

      inner.appendChild(serverRow);
    }
  } else {
    inner.appendChild(h("div", { className: "text-[11px] text-text-3 mb-3" }, "No MCP servers configured for this vault."));
  }

  // Add form (expandable)
  if (mcpShowAddForm) {
    inner.appendChild(buildMcpAddForm(root, vaultName, servers));
  }

  // Actions
  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-2 border-t border-edge" });
  if (!mcpShowAddForm) {
    actions.appendChild(btn("+ Add Server", {
      size: "sm",
      onClick: () => {
        mcpShowAddForm = true;
        renderRunnerDetail(root);
      },
    }));
  }
  actions.appendChild(h("div", { className: "flex-1" }));
  if (serverNames.length > 0) {
    actions.appendChild(btn("Remove All", {
      variant: "danger",
      size: "sm",
      onClick: async () => {
        if (!confirm(`Remove all MCP servers from vault "${vaultName}"?`)) return;
        await api.runnerConfig.removeVaultMcp(vaultName);
        renderRunnerDetail(root);
      },
    }));
  }
  inner.appendChild(actions);

  panel.appendChild(inner);
  return panel;
}

function buildMcpAddForm(root: HTMLElement, vaultName: string, existingServers: Record<string, any>): HTMLElement {
  const form = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 mb-2" });

  const inputCls = "w-full px-2.5 py-2 bg-surface-0 border border-edge rounded-md text-[12px] text-text-0 outline-hidden focus:border-accent font-[family-name:var(--font-sans)]";
  const labelCls = "text-[10px] font-medium text-text-3 uppercase tracking-wider mb-1.5";

  // Row 1: Name + Type
  const row1 = h("div", { className: "flex gap-3 mb-3" });

  const nameCol = h("div", { className: "flex-1" });
  nameCol.appendChild(h("div", { className: labelCls }, "Server Name"));
  const nameInput = document.createElement("input");
  nameInput.className = inputCls;
  nameInput.placeholder = "e.g. yt-mcp";
  nameCol.appendChild(nameInput);
  row1.appendChild(nameCol);

  const typeCol = h("div", { className: "w-[120px]" });
  typeCol.appendChild(h("div", { className: labelCls }, "Type"));
  const typeSelect = document.createElement("select");
  typeSelect.className = inputCls;
  typeSelect.appendChild(h("option", { value: "http" }, "HTTP"));
  typeSelect.appendChild(h("option", { value: "sse" }, "SSE"));
  typeCol.appendChild(typeSelect);
  row1.appendChild(typeCol);

  form.appendChild(row1);

  // Row 2: URL
  const urlField = h("div", { className: "mb-3" });
  urlField.appendChild(h("div", { className: labelCls }, "URL"));
  const urlInput = document.createElement("input");
  urlInput.className = inputCls;
  urlInput.placeholder = "https://service.example.com/mcp";
  urlField.appendChild(urlInput);
  form.appendChild(urlField);

  // Row 3: Headers (optional)
  const headersField = h("div", { className: "mb-3" });
  headersField.appendChild(h("div", { className: labelCls }, "Headers (optional, JSON)"));
  const headersInput = document.createElement("input");
  headersInput.className = inputCls;
  headersInput.placeholder = '{"Authorization": "Bearer mcp_..."}';
  headersField.appendChild(headersInput);
  form.appendChild(headersField);

  // Actions
  const formActions = h("div", { className: "flex items-center gap-2" });
  formActions.appendChild(h("div", { className: "flex-1" }));
  formActions.appendChild(btn("Cancel", {
    variant: "outline",
    size: "sm",
    onClick: () => {
      mcpShowAddForm = false;
      renderRunnerDetail(root);
    },
  }));
  formActions.appendChild(btn("Add Server", {
    size: "sm",
    onClick: async () => {
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      const type = typeSelect.value;
      if (!name || !url) return;

      const entry: Record<string, any> = { type, url };

      const headersVal = headersInput.value.trim();
      if (headersVal) {
        try {
          entry.headers = JSON.parse(headersVal);
        } catch {
          alert("Headers must be valid JSON");
          return;
        }
      }

      const updated = { ...existingServers, [name]: entry };
      await api.runnerConfig.setVaultMcp(vaultName, updated);
      mcpShowAddForm = false;
      renderRunnerDetail(root);
    },
  }));
  form.appendChild(formActions);

  return form;
}

function showRotatedKeyModal(root: HTMLElement, tenantName: string, newKey: string) {
  const body = h("div", {});

  const warn = h("div", { className: "bg-warn-soft border border-warn/12 rounded-md px-3 py-2.5 text-[11.5px] text-warn mb-4" });
  warn.textContent = "Copy now \u2014 the new key won\u2019t be shown again. The old key is now invalid.";
  body.appendChild(warn);

  const keyBox = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 font-mono text-[11.5px] text-accent break-all leading-relaxed relative" });
  keyBox.appendChild(h("span", { className: "font-sans text-[9.5px] text-text-3 uppercase tracking-wider block mb-1" }, "New API Key"));
  keyBox.appendChild(h("span", {}, newKey));
  const copyBtn = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(newKey, copyBtn) });
  copyBtn.className += " absolute top-2.5 right-2.5";
  keyBox.appendChild(copyBtn);
  body.appendChild(keyBox);

  const footer = h("div", { className: "flex justify-end mt-2" });
  footer.appendChild(btn("Done", { onClick: () => { hideModal(); renderRunnerDetail(root); } }));

  showModal(modalCard({ title: `Key Rotated — ${tenantName}`, body, footer }));
}

function showCreateRunnerModal(root: HTMLElement) {
  const nameInput = input({ placeholder: "e.g. andrew-laptop, ci-pipeline" });
  const maxSessionsInput = input({ placeholder: "5", type: "number" });
  maxSessionsInput.value = "5";

  const body = h("div", {});
  body.appendChild(field("Tenant Name", nameInput));
  body.appendChild(field("Max Sessions", maxSessionsInput, "Maximum concurrent sessions for this tenant"));

  const footer = h("div", { className: "flex justify-end gap-2 mt-1" });
  footer.appendChild(btn("Cancel", { variant: "outline", onClick: hideModal }));
  footer.appendChild(btn("Create", {
    onClick: async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const created = await api.runnerTokens.create(name);
      hideModal();

      // Show result — Tenant ID first, then API Key
      const resultBody = h("div", {});
      const warn = h("div", { className: "bg-warn-soft border border-warn/12 rounded-md px-3 py-2.5 text-[11.5px] text-warn mb-4" });
      warn.textContent = "Copy now \u2014 the key won\u2019t be shown again.";
      resultBody.appendChild(warn);

      // Tenant ID
      const idBox = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 font-mono text-[11.5px] text-text-1 break-all leading-relaxed mb-3" });
      idBox.appendChild(h("span", { className: "font-sans text-[9.5px] text-text-3 uppercase tracking-wider block mb-1" }, "Tenant ID"));
      idBox.appendChild(h("span", {}, created.id));
      resultBody.appendChild(idBox);

      // API Key
      const keyBox = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 font-mono text-[11.5px] text-accent break-all leading-relaxed relative" });
      keyBox.appendChild(h("span", { className: "font-sans text-[9.5px] text-text-3 uppercase tracking-wider block mb-1" }, "API Key"));
      keyBox.appendChild(h("span", {}, created.api_key || ""));
      const copyBtn = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(created.api_key || "", copyBtn) });
      copyBtn.className += " absolute top-2.5 right-2.5";
      keyBox.appendChild(copyBtn);
      resultBody.appendChild(keyBox);

      const resultFooter = h("div", { className: "flex justify-end mt-2" });
      resultFooter.appendChild(btn("Done", { onClick: () => { hideModal(); renderRunnerDetail(root); } }));

      showModal(modalCard({ title: "Tenant Created", body: resultBody, footer: resultFooter }));
    },
  }));

  showModal(modalCard({ title: "New Tenant", description: "Create a tenant with an API key for runner access.", body, footer }));
}
