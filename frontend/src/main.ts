import "./style.css";
import { getUserEmailFromCookie } from "./api";
import { renderServiceDetail } from "./pages/workbench";
import { renderRunnerDetail } from "./pages/runner-keys";
import { renderAclPage } from "./pages/acl";
import * as api from "./api";

type SelectedView = { type: "mcp"; service: api.McpService } | { type: "runner" } | { type: "acl" };

let allProjects: api.Project[] = [];
let allServices: api.McpService[] = [];
let currentProject: api.Project | null = null;
let selectedView: SelectedView | null = null;
let isAdmin = false;

export function getState() {
  return {
    currentProject,
    currentService: selectedView?.type === "mcp" ? selectedView.service : null,
    allProjects,
    allServices,
  };
}

export function setCurrentProject(project: api.Project | null) {
  currentProject = project;
  render();
}

function viewToPath(view: SelectedView | null): string {
  if (!view) return "/";
  if (view.type === "mcp") return `/service/${view.service.id}`;
  if (view.type === "runner") return "/platform/runner";
  if (view.type === "acl") return "/platform/acl";
  return "/";
}

function pathToView(path: string): SelectedView | null {
  if (path.startsWith("/service/")) {
    const id = path.slice("/service/".length);
    const svc = allServices.find((s) => s.id === id);
    if (svc) return { type: "mcp", service: svc };
  }
  if (path === "/platform/runner") return { type: "runner" };
  if (path === "/platform/acl") return { type: "acl" };
  // Default: first MCP service
  if (allServices.length > 0) return { type: "mcp", service: allServices[0] };
  return null;
}

function navigate(view: SelectedView) {
  selectedView = view;
  const path = viewToPath(view);
  if (window.location.pathname !== path) {
    history.pushState(null, "", path);
  }
  render();
}

async function loadData() {
  const [projectsResult, servicesResult] = await Promise.all([api.projects.list(), api.services.list()]);
  allProjects = projectsResult;
  allServices = servicesResult;
  if (!currentProject && allProjects.length > 0) currentProject = allProjects[0];
  // Restore view from URL path, or default to first MCP service
  selectedView = pathToView(window.location.pathname);

  // Check admin status (non-blocking — if ACL is not configured, defaults to false)
  try {
    const whoami = await api.aclAdmin.whoami();
    isAdmin = whoami.isAdmin;
  } catch {
    isAdmin = false;
  }
}

function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = "";
  app.className = "h-screen flex flex-col overflow-hidden";

  // ── Top Bar ──
  const topbar = document.createElement("header");
  topbar.className =
    "h-11 bg-surface-1 border-b border-edge flex items-center px-4 gap-3 shrink-0 z-20";

  // Brand
  const brand = document.createElement("div");
  brand.className = "text-[13px] font-semibold text-accent tracking-tight flex items-center gap-2 mr-3";
  const dot = document.createElement("span");
  dot.className = "w-[5px] h-[5px] bg-accent rounded-full shadow-[0_0_8px_var(--color-accent)]";
  brand.appendChild(dot);
  brand.appendChild(document.createTextNode("Cassandra"));
  topbar.appendChild(brand);

  // Spacer
  const spacer = document.createElement("div");
  spacer.className = "flex-1";
  topbar.appendChild(spacer);

  // Project switcher
  const projectPill = document.createElement("select");
  projectPill.className =
    "bg-surface-2 border border-edge rounded-md px-2.5 py-1 text-[11px] text-text-0 outline-hidden focus:border-accent font-[family-name:var(--font-sans)]";
  for (const p of allProjects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (currentProject && p.id === currentProject.id) opt.selected = true;
    projectPill.appendChild(opt);
  }
  projectPill.addEventListener("change", () => {
    currentProject = allProjects.find((p) => p.id === projectPill.value) || null;
    render();
  });
  topbar.appendChild(projectPill);

  // User
  const email = getUserEmailFromCookie();
  const userDiv = document.createElement("div");
  userDiv.className = "flex items-center gap-2 text-[11px] text-text-3";
  const avatar = document.createElement("div");
  avatar.className =
    "w-[22px] h-[22px] rounded-full bg-surface-4 border border-edge flex items-center justify-center text-[9px] font-semibold text-text-1";
  avatar.textContent = email[0]?.toUpperCase() || "?";
  userDiv.appendChild(avatar);
  userDiv.appendChild(document.createTextNode(email));
  const logout = document.createElement("a");
  logout.href = "/cdn-cgi/access/logout";
  logout.className = "text-[10.5px] text-text-3 hover:text-text-1 transition-colors ml-1";
  logout.textContent = "Sign out";
  userDiv.appendChild(logout);
  topbar.appendChild(userDiv);

  app.appendChild(topbar);

  // ── Layout ──
  const layout = document.createElement("div");
  layout.className = "flex flex-1 overflow-hidden";

  // ── Explorer Sidebar ──
  const sidebar = document.createElement("div");
  sidebar.className = "w-[210px] bg-surface-1 border-r border-edge flex flex-col shrink-0 overflow-y-auto";

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "px-3.5 py-2.5 text-[10px] font-semibold text-text-3 uppercase tracking-wider border-b border-edge";
  sidebarHeader.textContent = "Explorer";
  sidebar.appendChild(sidebarHeader);

  const sidebarBody = document.createElement("div");
  sidebarBody.className = "p-2 flex flex-col gap-0.5";

  // MCP Services section
  sidebarBody.appendChild(makeSectionLabel("MCP Services"));

  for (const svc of allServices.filter((s) => s.id !== "runner")) {
    const isActive = selectedView?.type === "mcp" && selectedView.service.id === svc.id;
    const item = makeSidebarItem(
      svc.name,
      false, // start grey, health check will update
      isActive,
      String(svc.tools?.length || 0),
      () => navigate({ type: "mcp", service: svc }),
      `status-dot-${svc.id}`,
    );

    // Config indicator
    const hasUserCreds = svc.credentialsSchema && svc.credentialsSchema.length > 0;
    const hasSvcCreds = svc.serviceCredentialsSchema && svc.serviceCredentialsSchema.length > 0;
    if (hasUserCreds || hasSvcCreds) {
      const configDot = document.createElement("span");
      configDot.className = "w-1.5 h-1.5 rounded-full shrink-0";
      configDot.id = `config-dot-${svc.id}`;
      item.appendChild(configDot);
    }

    sidebarBody.appendChild(item);
  }

  // Platform section
  sidebarBody.appendChild(makeSectionLabel("Platform"));

  const isRunnerActive = selectedView?.type === "runner";
  sidebarBody.appendChild(
    makeSidebarItem(
      "Agent Runner",
      false,
      isRunnerActive,
      undefined,
      () => navigate({ type: "runner" }),
      "status-dot-runner",
    ),
  );

  // Access Control (admin only)
  if (isAdmin) {
    const isAclActive = selectedView?.type === "acl";
    sidebarBody.appendChild(
      makeSidebarItem(
        "Access Control",
        true,
        isAclActive,
        undefined,
        () => navigate({ type: "acl" }),
      ),
    );
  }

  sidebar.appendChild(sidebarBody);
  layout.appendChild(sidebar);

  // ── Main Content ──
  const content = document.createElement("div");
  content.className = "flex-1 overflow-y-auto";
  content.id = "main-content";
  layout.appendChild(content);

  app.appendChild(layout);

  // Render content
  if (selectedView?.type === "mcp" && currentProject) {
    renderServiceDetail(content, currentProject, selectedView.service);
    checkConfigStatus();
  } else if (selectedView?.type === "runner") {
    renderRunnerDetail(content);
  } else if (selectedView?.type === "acl") {
    renderAclPage(content);
  }

  // Fetch live health status for all services
  checkServiceHealth();
}

function makeSectionLabel(text: string): HTMLElement {
  const label = document.createElement("div");
  label.className = "px-2 py-1.5 text-[9.5px] font-medium text-text-3 uppercase tracking-wider flex items-center gap-1 mt-2 first:mt-0";
  label.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-[10px] h-[10px]"><polyline points="6 9 12 15 18 9"/></svg>`;
  label.appendChild(document.createTextNode(" " + text));
  return label;
}

function makeSidebarItem(
  name: string,
  isActive: boolean,
  isSelected: boolean,
  badge?: string,
  onClick?: () => void,
  statusDotId?: string,
): HTMLElement {
  const item = document.createElement("div");
  item.className = `flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[12px] transition-all cursor-pointer ${
    isSelected
      ? "bg-accent-soft text-accent font-medium"
      : "text-text-2 hover:bg-surface-3 hover:text-text-1"
  }`;

  const statusDot = document.createElement("span");
  statusDot.className = `w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-ok" : "bg-text-3"}`;
  if (statusDotId) statusDot.id = statusDotId;
  item.appendChild(statusDot);

  item.appendChild(document.createTextNode(name));

  if (badge) {
    const count = document.createElement("span");
    count.className = "ml-auto text-[10px] text-text-3 bg-surface-3 px-1.5 py-px rounded-full";
    count.textContent = badge;
    item.appendChild(count);
  }

  if (onClick) item.addEventListener("click", onClick);
  return item;
}

async function checkConfigStatus() {
  if (!currentProject) return;
  for (const svc of allServices) {
    const hasUserCreds = svc.credentialsSchema && svc.credentialsSchema.length > 0;
    const hasSvcCreds = svc.serviceCredentialsSchema && svc.serviceCredentialsSchema.length > 0;
    if (!hasUserCreds && !hasSvcCreds) continue;
    const dotEl = document.getElementById(`config-dot-${svc.id}`);
    if (!dotEl) continue;
    try {
      let configured = false;
      if (hasUserCreds) {
        const meta = await api.credentials.get(currentProject.id, svc.id);
        configured = meta.has_credentials;
      }
      if (!configured && hasSvcCreds) {
        const resp = await api.serviceCredentials.get(svc.id);
        configured = resp.credentials !== null;
      }
      if (configured) {
        dotEl.className = "w-1.5 h-1.5 rounded-full shrink-0 bg-ok";
        dotEl.title = "Configuration set";
      } else {
        dotEl.className = "w-1.5 h-1.5 rounded-full shrink-0 bg-warn";
        dotEl.title = "Needs configuration";
      }
    } catch {
      dotEl.className = "w-1.5 h-1.5 rounded-full shrink-0 bg-text-3";
      dotEl.title = "Unknown";
    }
  }
}

async function checkServiceHealth() {
  try {
    const health = await api.services.health();
    for (const [id, online] of Object.entries(health)) {
      const dot = document.getElementById(`status-dot-${id}`);
      if (!dot) continue;
      dot.className = `w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-ok" : "bg-danger"}`;
      dot.title = online ? "Online" : "Offline";
    }
  } catch {
    // leave dots grey on failure
  }
}

// Handle browser back/forward
window.addEventListener("popstate", () => {
  selectedView = pathToView(window.location.pathname);
  render();
});

// Initial load
loadData().then(() => render());
