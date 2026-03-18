/** Shared UI primitives using Tailwind v4 classes. */

export function h(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | HTMLElement)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  }
  return el;
}

export function btn(label: string, opts: { variant?: "accent" | "outline" | "danger"; size?: "sm"; onClick?: () => void } = {}): HTMLButtonElement {
  const b = document.createElement("button");
  const base = "inline-flex items-center gap-1.5 font-medium rounded-md transition-all font-[family-name:var(--font-sans)]";
  const sizeClass = opts.size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs";
  const variants: Record<string, string> = {
    accent: "bg-accent text-surface-0 hover:bg-accent-hover",
    outline: "bg-transparent border border-edge text-text-2 hover:border-edge-active hover:text-text-1",
    danger: "bg-transparent text-danger hover:bg-danger-soft",
  };
  b.className = `${base} ${sizeClass} ${variants[opts.variant || "accent"]}`;
  b.textContent = label;
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

export function input(opts: { placeholder?: string; type?: string; id?: string } = {}): HTMLInputElement {
  const el = document.createElement("input");
  el.className =
    "w-full px-3 py-2 bg-surface-3 border border-edge rounded-md text-[12.5px] text-text-0 outline-hidden focus:border-accent font-[family-name:var(--font-sans)]";
  if (opts.placeholder) el.placeholder = opts.placeholder;
  if (opts.type) el.type = opts.type;
  if (opts.id) el.id = opts.id;
  return el;
}

export function textarea(opts: { placeholder?: string; rows?: number } = {}): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.className =
    "w-full px-3 py-2 bg-surface-3 border border-edge rounded-md text-[12.5px] text-text-0 outline-hidden focus:border-accent font-mono resize-y";
  el.rows = opts.rows || 4;
  if (opts.placeholder) el.placeholder = opts.placeholder;
  return el;
}

export function field(label: string, inputEl: HTMLElement, hint?: string): HTMLElement {
  const div = h("div", { className: "mb-4" });
  const lbl = h("label", {
    className: "block text-[10.5px] font-medium text-text-3 uppercase tracking-wider mb-1.5",
  }, label);
  div.appendChild(lbl);
  div.appendChild(inputEl);
  if (hint) {
    const hintEl = h("p", {
      className: "mt-1.5 text-[11px] text-text-3 whitespace-pre-line font-mono",
    });
    // Render URLs as clickable links
    hintEl.innerHTML = hint.replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" target="_blank" rel="noopener" class="text-accent underline hover:text-accent/80">$1</a>',
    );
    div.appendChild(hintEl);
  }
  return div;
}

export function pill(text: string, variant: "ok" | "neutral" = "ok"): HTMLElement {
  const cls = variant === "ok"
    ? "bg-ok-soft text-ok"
    : "bg-surface-4 text-text-2";
  return h("span", {
    className: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`,
  }, text);
}

export function mono(text: string): HTMLElement {
  return h("span", {
    className: "font-mono text-[11px] text-text-2 bg-surface-3 px-1.5 py-0.5 rounded",
  }, text);
}

export function emptyState(text: string): HTMLElement {
  return h("div", { className: "text-center py-10 text-text-3 text-[12.5px]" }, text);
}

export function fmtDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function maskKey(k: string): string {
  if (k.length <= 8) return k;
  return k.slice(0, 8) + "..." + k.slice(-4);
}

export async function copyToClipboard(text: string, button: HTMLElement) {
  await navigator.clipboard.writeText(text);
  const orig = button.textContent;
  button.textContent = "Copied!";
  button.classList.add("text-ok");
  setTimeout(() => {
    button.textContent = orig;
    button.classList.remove("text-ok");
  }, 2000);
}
