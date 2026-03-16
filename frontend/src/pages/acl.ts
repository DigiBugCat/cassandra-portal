import * as api from "../api";
import { h, btn, pill, emptyState } from "../components/ui";

let currentTab: "users" | "groups" | "domains" | "test" = "users";
let expandedId: string | null = null;

// Cached data
let cachedGroups: Record<string, api.AclGroupEntry> = {};
let cachedServices: api.McpService[] = [];

// Debounced auto-save: queues saves and only fires after 400ms of no changes.
// If a save is in-flight, waits for it to finish then saves again with latest state.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight = false;
let pendingSave: (() => Promise<void>) | null = null;
let pendingRoot: HTMLElement | null = null;

function debouncedSave(saveFn: () => Promise<void>, root: HTMLElement) {
  pendingSave = saveFn;
  pendingRoot = root;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (saveInFlight) return;
    await flushSave();
  }, 400);
}

async function flushSave() {
  while (pendingSave) {
    const fn = pendingSave;
    const root = pendingRoot;
    pendingSave = null;
    saveInFlight = true;
    try {
      await fn();
    } catch { /* silent */ }
    saveInFlight = false;
    // Re-render to update row summaries (preserves expandedId)
    if (root) renderAclPage(root);
  }
}


export async function renderAclPage(root: HTMLElement) {
  root.innerHTML = "";
  const container = h("div", { className: "p-6 max-w-[900px]" });

  const header = h("div", { className: "mb-5" });
  header.appendChild(h("h1", { className: "text-xl font-semibold mb-1" }, "Access Control"));
  const meta = h("div", { className: "flex items-center gap-3 text-xs text-text-2" });
  meta.appendChild(pill("Active", "ok"));
  meta.appendChild(h("span", {}, "Manage users, groups, domains, and test access policies"));
  header.appendChild(meta);
  container.appendChild(header);

  const tabs = h("div", { className: "flex gap-0.5 mb-4" });
  for (const tab of [
    { id: "users" as const, label: "Users" },
    { id: "groups" as const, label: "Groups" },
    { id: "domains" as const, label: "Domains" },
    { id: "test" as const, label: "Test Access" },
  ]) {
    const tabBtn = h("button", {
      className: `px-4 py-2 rounded-md text-xs transition-all font-[family-name:var(--font-sans)] ${
        currentTab === tab.id ? "bg-accent-soft text-accent font-medium" : "text-text-2 hover:bg-surface-3 hover:text-text-1"
      }`,
    }, tab.label);
    tabBtn.addEventListener("click", () => { currentTab = tab.id; expandedId = null; renderAclPage(root); });
    tabs.appendChild(tabBtn);
  }
  container.appendChild(tabs);

  try {
    [cachedGroups, cachedServices] = await Promise.all([api.aclAdmin.groups.list(), api.services.list()]);
  } catch { /* use cached */ }

  try {
    if (currentTab === "users") await renderUsersTab(container, root);
    else if (currentTab === "groups") await renderGroupsTab(container, root);
    else if (currentTab === "domains") await renderDomainsTab(container, root);
    else await renderTestTab(container);
  } catch (e) {
    container.appendChild(h("div", { className: "bg-danger-soft border border-danger/20 rounded-lg p-4 text-[12.5px] text-danger" },
      `Failed to load ACL data: ${(e as Error).message}`));
  }

  root.appendChild(container);
}

// ═══════════════════════════════════════
// Users Tab
// ═══════════════════════════════════════

async function renderUsersTab(container: HTMLElement, root: HTMLElement) {
  const users = await api.aclAdmin.users.list();
  const entries = Object.entries(users);
  const groupNames = Object.keys(cachedGroups);

  const bar = h("div", { className: "flex justify-between items-center mb-3" });
  bar.appendChild(h("span", { className: "text-xs text-text-3" }, `${entries.length} user${entries.length !== 1 ? "s" : ""}`));
  bar.appendChild(btn("+ Add User", { size: "sm", onClick: () => { expandedId = expandedId === "new-user" ? null : "new-user"; renderAclPage(root); } }));
  container.appendChild(bar);

  const list = h("div", { className: "flex flex-col border border-edge rounded-lg overflow-hidden" });

  if (expandedId === "new-user") {
    list.appendChild(buildNewUserForm(root, groupNames));
  }

  for (const [email, user] of entries) {
    const rowId = `user-${email}`;
    const isExpanded = expandedId === rowId;

    const row = makeRow(isExpanded);
    row.appendChild(h("span", { className: "font-mono text-[11.5px] font-medium min-w-[200px]" }, email));
    row.appendChild(h("span", {
      className: `text-[11px] px-2 py-0.5 rounded-full font-medium ${user.role === "admin" ? "bg-accent-soft text-accent" : "bg-surface-4 text-text-2"}`,
    }, user.role || "user"));
    const groupsDiv = h("div", { className: "flex gap-1 flex-wrap flex-1" });
    for (const g of user.groups || []) groupsDiv.appendChild(pill(g, "neutral"));
    row.appendChild(groupsDiv);
    row.appendChild(chevron(isExpanded));
    row.addEventListener("click", () => { expandedId = isExpanded ? null : rowId; renderAclPage(root); });
    list.appendChild(row);

    if (isExpanded) {
      list.appendChild(buildUserEditPanel(root, email, user, groupNames));
    }
  }

  if (entries.length === 0 && expandedId !== "new-user") {
    container.appendChild(emptyState("No users configured."));
  } else {
    container.appendChild(list);
  }
}

/** Auto-save helper for users: reads current form state and saves. */
function autoSaveUser(root: HTMLElement, email: string, inner: HTMLElement) {
  debouncedSave(async () => {
    const role = (inner.querySelector("#acl-role-select") as HTMLSelectElement).value as "admin" | "user";
    const groups = getSelectedChips("acl-groups");
    const userData: api.AclUserEntry = { role };
    if (groups.length > 0) userData.groups = groups;
    await api.aclAdmin.users.upsert(email, userData);
  }, root);
}

function buildUserEditPanel(root: HTMLElement, email: string, existing: api.AclUserEntry, groupNames: string[]): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  // Role — auto-save on change
  const roleSelect = document.createElement("select");
  roleSelect.className = inputClass;
  roleSelect.id = "acl-role-select";
  for (const role of ["user", "admin"]) {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = role;
    if (existing.role === role) opt.selected = true;
    roleSelect.appendChild(opt);
  }
  roleSelect.addEventListener("change", () => autoSaveUser(root, email, inner));
  inner.appendChild(fieldBlock("Role", roleSelect));

  // Groups — auto-save on chip click
  const chipSelect = buildChipSelect(groupNames, existing.groups || [], "acl-groups", () => autoSaveUser(root, email, inner));
  inner.appendChild(fieldBlock("Groups", chipSelect));

  // Save indicator + delete
  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(btn("Delete User", {
    variant: "danger", size: "sm",
    onClick: async () => {
      if (!confirm(`Remove "${email}" from ACL?`)) return;
      await api.aclAdmin.users.remove(email);
      expandedId = null;
      renderAclPage(root);
    },
  }));
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(h("span", { className: "text-[10px] text-text-3" }, "Auto-saved"));
  inner.appendChild(actions);

  panel.appendChild(inner);
  return panel;
}

function buildNewUserForm(root: HTMLElement, groupNames: string[]): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  const emailInput = document.createElement("input");
  emailInput.className = inputClass;
  emailInput.placeholder = "user@example.com";
  emailInput.id = "acl-email-input";
  inner.appendChild(fieldBlock("Email", emailInput));

  const roleSelect = document.createElement("select");
  roleSelect.className = inputClass;
  roleSelect.id = "acl-role-select";
  for (const role of ["user", "admin"]) {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = role;
    roleSelect.appendChild(opt);
  }
  inner.appendChild(fieldBlock("Role", roleSelect));
  inner.appendChild(fieldBlock("Groups", buildChipSelect(groupNames, [], "acl-groups")));

  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(btn("Cancel", { variant: "outline", size: "sm", onClick: () => { expandedId = null; renderAclPage(root); } }));
  actions.appendChild(btn("Add User", {
    size: "sm",
    onClick: async () => {
      const email = emailInput.value.trim().toLowerCase();
      if (!email) return;
      const role = roleSelect.value as "admin" | "user";
      const groups = getSelectedChips("acl-groups");
      const userData: api.AclUserEntry = { role };
      if (groups.length > 0) userData.groups = groups;
      await api.aclAdmin.users.upsert(email, userData);
      expandedId = null;
      renderAclPage(root);
    },
  }));
  inner.appendChild(actions);
  panel.appendChild(inner);
  return panel;
}

// ═══════════════════════════════════════
// Groups Tab
// ═══════════════════════════════════════

async function renderGroupsTab(container: HTMLElement, root: HTMLElement) {
  const entries = Object.entries(cachedGroups);

  const bar = h("div", { className: "flex justify-between items-center mb-3" });
  bar.appendChild(h("span", { className: "text-xs text-text-3" }, `${entries.length} group${entries.length !== 1 ? "s" : ""}`));
  bar.appendChild(btn("+ Add Group", { size: "sm", onClick: () => { expandedId = expandedId === "new-group" ? null : "new-group"; renderAclPage(root); } }));
  container.appendChild(bar);

  const list = h("div", { className: "flex flex-col border border-edge rounded-lg overflow-hidden" });

  if (expandedId === "new-group") {
    list.appendChild(buildNewGroupForm(root));
  }

  for (const [name, group] of entries) {
    const rowId = `group-${name}`;
    const isExpanded = expandedId === rowId;
    const svcNames = Object.keys(group.services);
    const denyCount = svcNames.reduce((sum, svc) => sum + (group.services[svc].tools?.deny?.length || 0), 0);

    const row = makeRow(isExpanded);
    row.appendChild(h("span", { className: "text-[12px] font-medium min-w-[120px]" }, name));
    const svcDiv = h("div", { className: "flex gap-1 flex-wrap flex-1" });
    for (const svc of svcNames) {
      const access = group.services[svc].access || "deny";
      svcDiv.appendChild(pill(`${svc}: ${access}`, access === "allow" ? "ok" : "neutral"));
    }
    row.appendChild(svcDiv);
    row.appendChild(h("span", { className: `text-[11px] ${denyCount > 0 ? "text-warn" : "text-text-3"}` }, denyCount > 0 ? `${denyCount} denied` : "No restrictions"));
    row.appendChild(chevron(isExpanded));
    row.addEventListener("click", () => { expandedId = isExpanded ? null : rowId; renderAclPage(root); });
    list.appendChild(row);

    if (isExpanded) {
      list.appendChild(buildGroupEditPanel(root, name, group));
    }
  }

  if (entries.length === 0 && expandedId !== "new-group") {
    container.appendChild(emptyState("No groups configured."));
  } else {
    container.appendChild(list);
  }
}

/** Read current group form state from DOM and save. */
function collectGroupServices(inner: HTMLElement): api.AclGroupEntry["services"] {
  const services: api.AclGroupEntry["services"] = {};
  for (const svc of cachedServices) {
    const toggle = inner.querySelector(`.svc-toggle[data-svc-id="${svc.id}"]`) as HTMLInputElement;
    const grid = inner.querySelector(`.tool-grid[data-svc-id="${svc.id}"]`);
    if (!toggle?.checked) continue;
    const denied: string[] = [];
    grid?.querySelectorAll("[data-tool]").forEach(chip => {
      if (chip.classList.contains("line-through")) denied.push(chip.getAttribute("data-tool")!);
    });
    const svcConfig: api.AclServiceConfig = { access: "allow" };
    if (denied.length > 0) svcConfig.tools = { deny: denied };
    services[svc.id] = svcConfig;
  }
  return services;
}

function autoSaveGroup(root: HTMLElement, name: string, inner: HTMLElement) {
  debouncedSave(async () => {
    const services = collectGroupServices(inner);
    await api.aclAdmin.groups.upsert(name, { services });
  }, root);
}

function buildGroupEditPanel(root: HTMLElement, name: string, existing: api.AclGroupEntry): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  inner.appendChild(h("div", { className: "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-2" }, "Service Permissions"));

  for (const svc of cachedServices) {
    inner.appendChild(buildServiceBlock(svc, existing.services[svc.id], () => autoSaveGroup(root, name, inner)));
  }

  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(btn("Delete Group", {
    variant: "danger", size: "sm",
    onClick: async () => {
      if (!confirm(`Remove group "${name}"?`)) return;
      await api.aclAdmin.groups.remove(name);
      expandedId = null;
      renderAclPage(root);
    },
  }));
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(h("span", { className: "text-[10px] text-text-3" }, "Auto-saved"));
  inner.appendChild(actions);

  panel.appendChild(inner);
  return panel;
}

function buildNewGroupForm(root: HTMLElement): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  const nameInput = document.createElement("input");
  nameInput.className = inputClass;
  nameInput.placeholder = "e.g. creators, internal";
  nameInput.id = "acl-group-name";
  inner.appendChild(fieldBlock("Group Name", nameInput));

  inner.appendChild(h("div", { className: "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-2" }, "Service Permissions"));
  for (const svc of cachedServices) {
    inner.appendChild(buildServiceBlock(svc, undefined));
  }

  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(btn("Cancel", { variant: "outline", size: "sm", onClick: () => { expandedId = null; renderAclPage(root); } }));
  actions.appendChild(btn("Add Group", {
    size: "sm",
    onClick: async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const services = collectGroupServices(inner);
      await api.aclAdmin.groups.upsert(name, { services });
      expandedId = null;
      renderAclPage(root);
    },
  }));
  inner.appendChild(actions);
  panel.appendChild(inner);
  return panel;
}

function buildServiceBlock(svc: api.McpService, existingSvc: api.AclServiceConfig | undefined, onChanged?: () => void): HTMLElement {
  const isEnabled = existingSvc?.access === "allow";
  const deniedTools = existingSvc?.tools?.deny || [];
  const registryTools = (svc.tools || []).map(t => t.split(" \u2014 ")[0].trim());
  const toolNames = [...registryTools, ...deniedTools.filter(t => !registryTools.includes(t))];

  const block = h("div", { className: "bg-surface-3 border border-edge rounded-md p-3 mb-2" });

  const header = h("div", { className: "flex items-center gap-2.5 mb-2" });
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "accent-accent w-3.5 h-3.5 cursor-pointer svc-toggle";
  toggle.checked = isEnabled;
  toggle.dataset.svcId = svc.id;
  if (onChanged) toggle.addEventListener("change", onChanged);
  header.appendChild(toggle);
  header.appendChild(h("span", { className: "text-[12px] font-medium" }, svc.name));
  header.appendChild(h("span", { className: "text-[11px] text-text-3" }, `\u2014 ${svc.description}`));
  block.appendChild(header);

  block.appendChild(h("div", { className: "text-[10px] text-text-3 mb-1.5" }, "Click tools to deny"));
  const toolGrid = h("div", { className: "flex flex-wrap gap-1 tool-grid" });
  toolGrid.dataset.svcId = svc.id;
  for (const tool of toolNames) {
    const isDenied = deniedTools.includes(tool);
    const chip = h("div", {
      className: `text-[10.5px] font-mono px-2 py-1 rounded border cursor-pointer transition-all select-none ${
        isDenied ? "bg-danger-soft border-danger/50 text-danger line-through" : "border-edge text-text-2 hover:border-text-3"
      }`,
    }, tool);
    chip.dataset.tool = tool;
    chip.addEventListener("click", () => {
      chip.classList.toggle("bg-danger-soft");
      chip.classList.toggle("border-danger/50");
      chip.classList.toggle("text-danger");
      chip.classList.toggle("line-through");
      chip.classList.toggle("border-edge");
      chip.classList.toggle("text-text-2");
      if (onChanged) onChanged();
    });
    toolGrid.appendChild(chip);
  }
  block.appendChild(toolGrid);
  return block;
}

// ═══════════════════════════════════════
// Domains Tab
// ═══════════════════════════════════════

async function renderDomainsTab(container: HTMLElement, root: HTMLElement) {
  const domains = await api.aclAdmin.domains.list();
  const entries = Object.entries(domains);
  const groupNames = Object.keys(cachedGroups);

  const bar = h("div", { className: "flex justify-between items-center mb-3" });
  bar.appendChild(h("span", { className: "text-xs text-text-3" }, `${entries.length} domain${entries.length !== 1 ? "s" : ""}`));
  bar.appendChild(btn("+ Add Domain", { size: "sm", onClick: () => { expandedId = expandedId === "new-domain" ? null : "new-domain"; renderAclPage(root); } }));
  container.appendChild(bar);

  const list = h("div", { className: "flex flex-col border border-edge rounded-lg overflow-hidden" });

  if (expandedId === "new-domain") {
    list.appendChild(buildNewDomainForm(root, groupNames));
  }

  for (const [domain, def] of entries) {
    const rowId = `domain-${domain}`;
    const isExpanded = expandedId === rowId;

    const row = makeRow(isExpanded);
    row.appendChild(h("span", { className: "font-mono text-[11.5px] font-medium min-w-[200px]" }, domain));
    const groupsDiv = h("div", { className: "flex gap-1 flex-wrap flex-1" });
    for (const g of def.groups || []) groupsDiv.appendChild(pill(g, "neutral"));
    row.appendChild(groupsDiv);
    row.appendChild(chevron(isExpanded));
    row.addEventListener("click", () => { expandedId = isExpanded ? null : rowId; renderAclPage(root); });
    list.appendChild(row);

    if (isExpanded) {
      list.appendChild(buildDomainEditPanel(root, domain, def, groupNames));
    }
  }

  if (entries.length === 0 && expandedId !== "new-domain") {
    container.appendChild(emptyState("No domain rules configured."));
  } else {
    container.appendChild(list);
  }
}

function autoSaveDomain(root: HTMLElement, domain: string) {
  debouncedSave(async () => {
    const groups = getSelectedChips("acl-domain-groups");
    await api.aclAdmin.domains.upsert(domain, { groups });
  }, root);
}

function buildDomainEditPanel(root: HTMLElement, domain: string, existing: api.AclDomainEntry, groupNames: string[]): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  inner.appendChild(fieldBlock("Groups",
    buildChipSelect(groupNames, existing.groups || [], "acl-domain-groups", () => autoSaveDomain(root, domain)),
    "All users with this email domain get assigned to selected groups"));

  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(btn("Delete Domain", {
    variant: "danger", size: "sm",
    onClick: async () => {
      if (!confirm(`Remove domain rule "${domain}"?`)) return;
      await api.aclAdmin.domains.remove(domain);
      expandedId = null;
      renderAclPage(root);
    },
  }));
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(h("span", { className: "text-[10px] text-text-3" }, "Auto-saved"));
  inner.appendChild(actions);

  panel.appendChild(inner);
  return panel;
}

function buildNewDomainForm(root: HTMLElement, groupNames: string[]): HTMLElement {
  const panel = h("div", { className: "bg-surface-1 px-4 pt-3 pb-4" });
  const inner = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-4" });

  const domainInput = document.createElement("input");
  domainInput.className = inputClass;
  domainInput.placeholder = "example.com";
  domainInput.id = "acl-domain-input";
  inner.appendChild(fieldBlock("Domain", domainInput));
  inner.appendChild(fieldBlock("Groups", buildChipSelect(groupNames, [], "acl-domain-groups"),
    "All users with this email domain get assigned to selected groups"));

  const actions = h("div", { className: "flex items-center gap-2 pt-3 mt-3 border-t border-edge" });
  actions.appendChild(h("div", { className: "flex-1" }));
  actions.appendChild(btn("Cancel", { variant: "outline", size: "sm", onClick: () => { expandedId = null; renderAclPage(root); } }));
  actions.appendChild(btn("Add Domain", {
    size: "sm",
    onClick: async () => {
      const domain = domainInput.value.trim().toLowerCase();
      if (!domain) return;
      const groups = getSelectedChips("acl-domain-groups");
      await api.aclAdmin.domains.upsert(domain, { groups });
      expandedId = null;
      renderAclPage(root);
    },
  }));
  inner.appendChild(actions);
  panel.appendChild(inner);
  return panel;
}

// ═══════════════════════════════════════
// Test Tab
// ═══════════════════════════════════════

async function renderTestTab(container: HTMLElement) {
  const form = h("div", { className: "bg-surface-2 border border-edge rounded-lg p-5" });

  const emailInput = document.createElement("input");
  emailInput.className = inputClass;
  emailInput.placeholder = "user@example.com";
  form.appendChild(fieldBlock("Email", emailInput));

  const row = h("div", { className: "flex gap-3" });
  const serviceSelect = document.createElement("select");
  serviceSelect.className = inputClass;
  for (const svc of cachedServices) {
    const opt = document.createElement("option");
    opt.value = svc.id;
    opt.textContent = `${svc.name} \u2014 ${svc.description}`;
    serviceSelect.appendChild(opt);
  }

  const toolSelect = document.createElement("select");
  toolSelect.className = inputClass;
  function populateTools() {
    toolSelect.innerHTML = "";
    const svc = cachedServices.find(s => s.id === serviceSelect.value);
    for (const tool of svc?.tools || []) {
      const opt = document.createElement("option");
      const name = tool.split(" \u2014 ")[0].trim();
      opt.value = name;
      opt.textContent = name;
      toolSelect.appendChild(opt);
    }
  }
  serviceSelect.addEventListener("change", populateTools);
  populateTools();

  const svcField = h("div", { className: "flex-1" });
  svcField.appendChild(h("div", { className: "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-1.5" }, "Service"));
  svcField.appendChild(serviceSelect);
  row.appendChild(svcField);
  const toolField = h("div", { className: "flex-1" });
  toolField.appendChild(h("div", { className: "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-1.5" }, "Tool"));
  toolField.appendChild(toolSelect);
  row.appendChild(toolField);
  form.appendChild(h("div", { className: "mb-4" }, row));

  const resultBox = h("div", { className: "hidden mt-4" });
  const testBtn = btn("Test Access", {
    onClick: async () => {
      const email = emailInput.value.trim();
      const service = serviceSelect.value;
      const tool = toolSelect.value;
      if (!email || !service || !tool) return;
      resultBox.innerHTML = "";
      resultBox.classList.remove("hidden");
      try {
        const result = await api.aclAdmin.test(email, service, tool);
        const el = h("div", { className: "flex items-center gap-2 bg-surface-3 border border-edge rounded-md p-3" });
        el.appendChild(pill(result.allowed ? "Allowed" : "Denied", result.allowed ? "ok" : "neutral"));
        el.appendChild(h("span", { className: "text-[12px] text-text-2" }, result.reason));
        resultBox.appendChild(el);
      } catch (e) {
        resultBox.appendChild(h("div", { className: "bg-danger-soft border border-danger/20 rounded-md p-3 text-[12px] text-danger" },
          `Error: ${(e as Error).message}`));
      }
    },
  });
  form.appendChild(h("div", { className: "pt-1" }, testBtn));
  form.appendChild(resultBox);
  container.appendChild(form);
}

// ═══════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════

const inputClass = "w-full px-3 py-2 bg-surface-3 border border-edge rounded-md text-[12.5px] text-text-0 outline-hidden focus:border-accent font-[family-name:var(--font-sans)]";

function makeRow(isExpanded: boolean): HTMLElement {
  return h("div", {
    className: `flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-edge ${
      isExpanded ? "bg-surface-1 border-b-transparent" : "bg-surface-2 hover:bg-surface-3 last:border-b-transparent"
    }`,
  });
}

function chevron(isExpanded: boolean): HTMLElement {
  return h("span", { className: `text-text-3 transition-transform text-base ${isExpanded ? "rotate-90" : ""}` }, "\u203A");
}

function fieldBlock(label: string, content: HTMLElement, hint?: string): HTMLElement {
  const div = h("div", { className: "mb-4" });
  div.appendChild(h("div", { className: "text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-1.5" }, label));
  div.appendChild(content);
  if (hint) div.appendChild(h("p", { className: "mt-1.5 text-[10px] text-text-3" }, hint));
  return div;
}

function buildChipSelect(options: string[], selected: string[], groupId: string, onChanged?: () => void): HTMLElement {
  const container = h("div", { className: "flex flex-wrap gap-1.5" });
  container.id = groupId;
  for (const opt of options) {
    const isSelected = selected.includes(opt);
    const chip = h("div", {
      className: `text-[11px] px-2.5 py-1 rounded-md border cursor-pointer transition-all select-none ${
        isSelected ? "bg-accent-soft border-accent/50 text-accent font-medium" : "border-edge text-text-2 hover:border-text-3 hover:text-text-1"
      }`,
    }, opt);
    chip.dataset.value = opt;
    chip.addEventListener("click", () => {
      const isSel = chip.classList.contains("text-accent");
      chip.className = `text-[11px] px-2.5 py-1 rounded-md border cursor-pointer transition-all select-none ${
        !isSel ? "bg-accent-soft border-accent/50 text-accent font-medium" : "border-edge text-text-2 hover:border-text-3 hover:text-text-1"
      }`;
      if (onChanged) onChanged();
    });
    container.appendChild(chip);
  }
  return container;
}

function getSelectedChips(groupId: string): string[] {
  const container = document.getElementById(groupId);
  if (!container) return [];
  const chips: string[] = [];
  container.querySelectorAll("[data-value]").forEach(chip => {
    if (chip.classList.contains("text-accent")) chips.push(chip.getAttribute("data-value")!);
  });
  return chips;
}
