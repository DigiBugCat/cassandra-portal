import * as api from "../api";
import { h, btn, input, field, mono, pill, emptyState, fmtDate, copyToClipboard } from "../components/ui";
import { showModal, hideModal, modalCard } from "../components/modal";

export async function renderRunnerDetail(root: HTMLElement) {
  root.innerHTML = "";
  const container = h("div", { className: "p-6 max-w-[900px]" });

  // ── Header ──
  const header = h("div", { className: "mb-5" });
  header.appendChild(h("h1", { className: "text-xl font-semibold mb-1" }, "Claude Code Runner"));
  const meta = h("div", { className: "flex items-center gap-3 text-xs text-text-2" });
  meta.appendChild(pill("Active", "ok"));
  meta.appendChild(h("span", {}, "Claude Code Runner — isolated sessions in k8s pods"));
  header.appendChild(meta);

  api.getDomain().then((domain) => {
    if (domain) {
      header.appendChild(h("div", { className: "mt-1.5 font-mono text-[11px] text-text-3" }, `claude-runner.${domain}`));
    }
  });
  container.appendChild(header);

  // ── Quick Setup ──
  const domain = await api.getDomain();
  const setup = h("div", { className: "bg-accent-soft/60 border border-accent/20 rounded-lg p-4 mb-6" });

  const setupLabel = h("div", { className: "text-[10.5px] font-semibold text-accent uppercase tracking-wider mb-3 flex items-center gap-1.5" });
  setupLabel.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
  setupLabel.appendChild(document.createTextNode(" Quick Setup"));
  setup.appendChild(setupLabel);

  // Usage
  const usageLabel = h("div", { className: "text-[10px] font-medium text-text-2 uppercase tracking-wider mb-1.5" }, "Connect via Claude Code CLI");
  setup.appendChild(usageLabel);

  const usageCmd = `claude --runner-url https://claude-runner.${domain} --runner-api-key <your-key>`;
  const usageBox = h("div", { className: "bg-surface-0 border border-edge rounded-md p-3 font-mono text-[11px] text-accent break-all leading-relaxed relative mb-4" });
  usageBox.appendChild(document.createTextNode(usageCmd));
  const usageCopy = btn("Copy", { variant: "outline", size: "sm", onClick: () => copyToClipboard(usageCmd, usageCopy) });
  usageCopy.className += " absolute top-2 right-2";
  usageBox.appendChild(usageCopy);
  setup.appendChild(usageBox);

  // Env var alternative
  const envLabel = h("div", { className: "text-[10px] font-medium text-text-2 uppercase tracking-wider mb-1.5" }, "Or set environment variables");
  setup.appendChild(envLabel);

  const envBox = h("div", { className: "bg-surface-0 border border-edge rounded-md p-3 font-mono text-[11px] text-text-1 leading-relaxed whitespace-pre" });
  envBox.innerHTML = `<span class="text-text-3">export</span> <span class="text-accent">CLAUDE_RUNNER_URL</span>=https://claude-runner.${domain}
<span class="text-text-3">export</span> <span class="text-accent">CLAUDE_RUNNER_API_KEY</span>=&lt;your-key&gt;`;
  setup.appendChild(envBox);

  container.appendChild(setup);

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
  root.appendChild(container);
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
