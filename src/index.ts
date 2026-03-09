import { Hono } from "hono";
import { runnerProxy } from "./runner-proxy";
import { mcpKeys } from "./mcp-keys";

const app = new Hono<{ Bindings: Env }>();

// Mount API routes
app.route("/", runnerProxy);
app.route("/", mcpKeys);

// Serve portal HTML for all other routes
app.all("*", (c) => {
  const html = PORTAL_HTML.replace("__DOMAIN__", c.env.DOMAIN || "");
  return c.html(html);
});

export default app;

// ── Portal HTML (Design 2: Dense) ──

const PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cassandra Portal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg-0:#08070b;--bg-1:#0e0d13;--bg-2:#15141b;--bg-3:#1d1c24;--bg-4:#25242e;--border:#2e2d38;--border-active:#454359;--text-0:#f0eef8;--text-1:#c4c0d4;--text-2:#8a86a0;--text-3:#5c586e;--purple:#9b7cf8;--purple-soft:rgba(155,124,248,0.1);--green:#4ade80;--green-soft:rgba(74,222,128,0.1);--red:#fb7185;--red-soft:rgba(251,113,133,0.1);--amber:#fbbf24;--amber-soft:rgba(251,191,36,0.08);--top-bar:44px}
body{font-family:'Sora',sans-serif;background:var(--bg-0);color:var(--text-0);min-height:100vh;font-size:13px}
.topbar{height:var(--top-bar);background:var(--bg-1);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:24px;position:sticky;top:0;z-index:20}
.topbar-brand{font-size:14px;font-weight:600;color:var(--purple);letter-spacing:-0.01em;margin-right:8px;display:flex;align-items:center;gap:8px}
.topbar-brand .dot{width:6px;height:6px;background:var(--purple);border-radius:50%;box-shadow:0 0 8px var(--purple)}
.topbar-nav{display:flex;gap:2px;flex:1}
.topbar-tab{padding:8px 16px;border-radius:6px;color:var(--text-2);font-size:12.5px;font-weight:400;cursor:pointer;transition:all .12s;text-decoration:none}
.topbar-tab:hover{background:var(--bg-3);color:var(--text-1)}
.topbar-tab.active{background:var(--purple-soft);color:var(--purple);font-weight:500}
.topbar-user{font-size:11.5px;color:var(--text-3);display:flex;align-items:center;gap:8px}
.topbar-user .avatar{width:24px;height:24px;border-radius:50%;background:var(--bg-4);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--text-1)}
.layout{padding:20px;max-width:1400px;margin:0 auto}
.page{display:none}.page.active{display:block}
.dash-top{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.metric{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;gap:6px}
.metric-top{display:flex;justify-content:space-between;align-items:center}
.metric-label{font-size:11px;font-weight:400;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em}
.metric-badge{font-size:10px;padding:2px 7px;border-radius:4px;font-weight:500}
.metric-badge.up{background:var(--green-soft);color:var(--green)}
.metric-badge.neutral{background:var(--bg-4);color:var(--text-2)}
.metric-value{font-size:28px;font-weight:600;letter-spacing:-0.02em;line-height:1}
.metric-sub{font-size:11px;color:var(--text-3)}
.dash-grid{display:grid;grid-template-columns:2fr 1fr;gap:12px}
.panel{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.panel-header{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.panel-title{font-size:12px;font-weight:500;color:var(--text-1)}
.mini-table{width:100%;border-collapse:collapse}
.mini-table th{text-align:left;padding:8px 18px;font-size:10px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;background:var(--bg-3)}
.mini-table td{padding:10px 18px;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--text-1)}
.mini-table tr:last-child td{border-bottom:none}
.tokens-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.tokens-count{font-size:12px;color:var(--text-3)}.tokens-count strong{color:var(--text-1)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:6px;font-family:'Sora',sans-serif;font-size:12px;font-weight:500;border:none;cursor:pointer;transition:all .12s}
.btn-accent{background:var(--purple);color:var(--bg-0)}.btn-accent:hover{background:#ae90ff}
.btn-sm{padding:4px 10px;font-size:11px;border-radius:5px}
.btn-outline{background:transparent;border:1px solid var(--border);color:var(--text-2)}.btn-outline:hover{border-color:var(--border-active);color:var(--text-1)}
.btn-red-sm{background:transparent;border:1px solid transparent;color:var(--red);padding:4px 10px;font-size:11px;font-family:'Sora',sans-serif;cursor:pointer;border-radius:5px}.btn-red-sm:hover{background:var(--red-soft)}
.full-table{width:100%;border-collapse:collapse;background:var(--bg-2);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.full-table th{text-align:left;padding:10px 18px;font-size:10.5px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;background:var(--bg-3);border-bottom:1px solid var(--border)}
.full-table td{padding:14px 18px;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--text-1)}
.full-table tr:last-child td{border-bottom:none}
.full-table tr:hover td{background:rgba(155,124,248,0.02)}
.mono{font-family:'Geist Mono',monospace;font-size:11px;color:var(--text-2);background:var(--bg-3);padding:2px 6px;border-radius:3px}
.pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.pill.active{background:var(--green-soft);color:var(--green)}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(3px);z-index:100;align-items:center;justify-content:center}
.modal-overlay.active{display:flex}
.modal{background:var(--bg-1);border:1px solid var(--border);border-radius:10px;padding:24px;width:440px;animation:slideUp .18s ease}
@keyframes slideUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.modal h3{font-size:15px;font-weight:600;margin-bottom:6px}
.modal .desc{font-size:12px;color:var(--text-2);margin-bottom:20px}
.field{margin-bottom:16px}
.field label{display:block;font-size:10.5px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.field input{width:100%;padding:8px 12px;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;font-family:'Sora',sans-serif;font-size:12.5px;color:var(--text-0);outline:none}
.field input:focus{border-color:var(--purple)}
.cred-box{background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;font-family:'Geist Mono',monospace;font-size:11.5px;color:var(--purple);word-break:break-all;line-height:1.5;position:relative}
.cred-box .key{font-family:'Sora',sans-serif;font-size:9.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:3px}
.copy-btn{position:absolute;top:10px;right:10px;background:var(--bg-4);border:1px solid var(--border);border-radius:5px;padding:5px 7px;cursor:pointer;color:var(--text-2);transition:all .12s;display:flex;align-items:center;gap:4px;font-family:'Sora',sans-serif;font-size:10px}
.copy-btn:hover{background:var(--purple-soft);color:var(--purple);border-color:var(--purple)}
.copy-btn.copied{background:var(--green-soft);color:var(--green);border-color:transparent}
.warn-banner{background:var(--amber-soft);border:1px solid rgba(251,191,36,0.12);border-radius:6px;padding:10px 12px;font-size:11.5px;color:var(--amber);margin-bottom:16px;display:flex;align-items:center;gap:8px}
.modal-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.monitor-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;background:var(--bg-2);border:1px dashed var(--border);border-radius:10px}
.monitor-empty h3{font-size:14px;font-weight:500;color:var(--text-2);margin-bottom:4px}
.monitor-empty p{font-size:12px;color:var(--text-3)}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--purple);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.empty-state{text-align:center;padding:40px;color:var(--text-3);font-size:12.5px}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-brand"><span class="dot"></span>Cassandra</div>
  <nav class="topbar-nav">
    <a class="topbar-tab active" data-page="dashboard">Dashboard</a>
    <a class="topbar-tab" data-page="tokens">Runner Keys</a>
    <a class="topbar-tab" data-page="mcp-keys">MCP Keys</a>
    <a class="topbar-tab" data-page="monitoring">Monitoring</a>
  </nav>
  <div class="topbar-user">
    <div class="avatar">?</div>
    <span id="user-email">loading...</span>
  </div>
</header>
<div class="layout">
  <!-- Dashboard -->
  <div class="page active" id="page-dashboard">
    <div class="dash-top">
      <div class="metric"><div class="metric-top"><span class="metric-label">Runner Keys</span><span class="metric-badge neutral" id="dash-token-badge">-</span></div><div class="metric-value" id="dash-token-count">-</div><div class="metric-sub" id="dash-token-sub">loading...</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">MCP Keys</span><span class="metric-badge neutral" id="dash-mcp-badge">-</span></div><div class="metric-value" id="dash-mcp-count">-</div><div class="metric-sub" id="dash-mcp-sub">loading...</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">Endpoint</span></div><div class="metric-value" style="font-size:12px;margin-top:8px;color:var(--text-1);word-break:break-all" id="dash-endpoint">-</div><div class="metric-sub">via Cloudflare Tunnel</div></div>
      <div class="metric"><div class="metric-top"><span class="metric-label">Auth</span></div><div class="metric-value" style="font-size:14px;margin-top:6px">API Keys</div><div class="metric-sub">X-API-Key (runner) / Bearer (MCP)</div></div>
    </div>
    <div class="dash-grid">
      <div class="panel"><div class="panel-header"><span class="panel-title">Recent Runner Keys</span><a class="btn btn-sm btn-outline" style="cursor:pointer" data-nav="tokens">View All</a></div><div class="panel-body"><table class="mini-table"><thead><tr><th>Name</th><th>Namespace</th><th>Max Sessions</th><th>Created</th></tr></thead><tbody id="dash-tokens-body"><tr><td colspan="4" class="empty-state">Loading...</td></tr></tbody></table></div></div>
      <div class="panel"><div class="panel-header"><span class="panel-title">Quick Links</span></div><div style="padding:14px 18px;display:flex;flex-direction:column;gap:8px">
        <a id="link-grafana" href="#" target="_blank" style="color:var(--text-1);font-size:12px;text-decoration:none;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#x1F4CA;</span> Grafana</a>
        <a id="link-argocd" href="#" target="_blank" style="color:var(--text-1);font-size:12px;text-decoration:none;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#x1F680;</span> ArgoCD</a>
        <a href="https://github.com/DigiBugCat" target="_blank" style="color:var(--text-1);font-size:12px;text-decoration:none;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#x1F419;</span> GitHub Org</a>
      </div></div>
    </div>
  </div>

  <!-- Runner Keys -->
  <div class="page" id="page-tokens">
    <div class="tokens-bar">
      <div class="tokens-count" id="tokens-count">Loading...</div>
      <button class="btn btn-accent" onclick="showCreateModal('runner')">+ New Runner Key</button>
    </div>
    <table class="full-table"><thead><tr><th>Name</th><th>Namespace</th><th>Max Sessions</th><th>Created</th><th></th></tr></thead><tbody id="tokens-body"><tr><td colspan="5" class="empty-state">Loading...</td></tr></tbody></table>
  </div>

  <!-- MCP Keys -->
  <div class="page" id="page-mcp-keys">
    <div class="tokens-bar">
      <div class="tokens-count" id="mcp-keys-count">Loading...</div>
      <button class="btn btn-accent" onclick="showCreateModal('mcp')">+ New MCP Key</button>
    </div>
    <table class="full-table"><thead><tr><th>Name</th><th>Key</th><th>Created By</th><th>Created</th><th></th></tr></thead><tbody id="mcp-keys-body"><tr><td colspan="5" class="empty-state">Loading...</td></tr></tbody></table>
  </div>

  <!-- Monitoring -->
  <div class="page" id="page-monitoring">
    <div class="monitor-empty"><h3>&#x1F4CA; Grafana Dashboards</h3><p>Monitoring dashboards will be embedded here</p></div>
  </div>
</div>

<!-- Modal -->
<div class="modal-overlay" id="modal">
  <div class="modal" id="modal-create">
    <h3 id="modal-create-title">New Key</h3>
    <p class="desc" id="modal-create-desc">Create a new key.</p>
    <div class="field"><label>Name</label><input id="key-name" placeholder="e.g. andrew-laptop, ci-pipeline"></div>
    <div class="modal-footer"><button class="btn btn-outline" onclick="hideModal()">Cancel</button><button class="btn btn-accent" id="create-btn" onclick="createKey()">Create</button></div>
  </div>
  <div class="modal" id="modal-result" style="display:none">
    <h3>Key Created</h3>
    <div class="warn-banner">&#x26A0; Copy now — the key won't be shown again.</div>
    <div class="cred-box"><span class="key">API Key</span><span id="new-api-key"></span><button class="copy-btn" onclick="copyText('new-api-key',this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div>
    <div id="result-tenant-row" class="cred-box"><span class="key">Tenant ID</span><span id="new-tenant-id"></span></div>
    <div class="modal-footer"><button class="btn btn-accent" onclick="hideModal(); loadAll();">Done</button></div>
  </div>
</div>

<script>
// ── State ──
var createMode = 'runner'; // 'runner' or 'mcp'

// ── Nav ──
document.querySelectorAll('.topbar-tab').forEach(function(t){t.addEventListener('click',function(){document.querySelectorAll('.topbar-tab').forEach(function(x){x.classList.remove('active')});t.classList.add('active');document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});document.getElementById('page-'+t.dataset.page).classList.add('active')})});
document.querySelectorAll('[data-nav]').forEach(function(l){l.addEventListener('click',function(e){e.preventDefault();var p=l.dataset.nav;document.querySelectorAll('.topbar-tab').forEach(function(t){t.classList.toggle('active',t.dataset.page===p)});document.querySelectorAll('.page').forEach(function(pg){pg.classList.remove('active')});document.getElementById('page-'+p).classList.add('active')})});

// ── User info from CF Access JWT ──
try{var jwt=document.cookie.split(';').map(function(c){return c.trim()}).find(function(c){return c.startsWith('CF_Authorization=')});if(jwt){var payload=JSON.parse(atob(jwt.split('=')[1].split('.')[1]));document.getElementById('user-email').textContent=payload.email||'unknown';document.querySelector('.avatar').textContent=(payload.email||'?')[0].toUpperCase()}}catch(e){document.getElementById('user-email').textContent='authenticated'}

// ── Runner Keys API ──
function loadTokens(){
  fetch('/api/tokens').then(function(r){return r.json()}).then(function(tenants){
    if(tenants.error)throw new Error(tenants.error);
    renderTokens(tenants);
  }).catch(function(e){
    document.getElementById('tokens-body').innerHTML='<tr><td colspan="5" class="empty-state">Failed to load: '+e.message+'</td></tr>';
  });
}

function renderTokens(tenants){
  document.getElementById('dash-token-count').textContent=tenants.length;
  document.getElementById('dash-token-badge').textContent=tenants.length+' total';
  document.getElementById('dash-token-sub').textContent=tenants.length+' active';
  document.getElementById('tokens-count').innerHTML='<strong>'+tenants.length+'</strong> runner keys';
  var recent=tenants.slice(0,4);
  document.getElementById('dash-tokens-body').innerHTML=recent.length?recent.map(function(t){return '<tr><td style="font-weight:500">'+esc(t.name)+'</td><td><code class="mono">'+esc(t.namespace)+'</code></td><td>'+t.max_sessions+'</td><td style="color:var(--text-3)">'+fmtDate(t.created_at)+'</td></tr>'}).join(''):'<tr><td colspan="4" class="empty-state">No runner keys yet</td></tr>';
  var rows=tenants.map(function(t){return '<tr><td style="font-weight:500">'+esc(t.name)+'</td><td><code class="mono">'+esc(t.namespace)+'</code></td><td>'+t.max_sessions+'</td><td style="color:var(--text-3)">'+fmtDate(t.created_at)+'</td><td style="text-align:right"><button class="btn-red-sm" onclick="deleteTenant(\\''+t.id+'\\',\\''+esc(t.name)+'\\')">Delete</button></td></tr>'});
  document.getElementById('tokens-body').innerHTML=rows.length?rows.join(''):'<tr><td colspan="5" class="empty-state">No runner keys yet. Create one to get started.</td></tr>';
}

// ── MCP Keys API ──
function loadMcpKeys(){
  fetch('/api/mcp-keys').then(function(r){return r.json()}).then(function(keys){
    if(keys.error)throw new Error(keys.error);
    renderMcpKeys(keys);
  }).catch(function(e){
    document.getElementById('mcp-keys-body').innerHTML='<tr><td colspan="5" class="empty-state">Failed to load: '+e.message+'</td></tr>';
  });
}

function maskKey(k){if(k.length<=8)return k;return k.slice(0,8)+'...'+k.slice(-4)}

function renderMcpKeys(keys){
  document.getElementById('dash-mcp-count').textContent=keys.length;
  document.getElementById('dash-mcp-badge').textContent=keys.length+' total';
  document.getElementById('dash-mcp-sub').textContent=keys.length+' active';
  document.getElementById('mcp-keys-count').innerHTML='<strong>'+keys.length+'</strong> MCP keys';
  var rows=keys.map(function(k){return '<tr><td style="font-weight:500">'+esc(k.name)+'</td><td><code class="mono">'+esc(maskKey(k.key))+'</code></td><td style="color:var(--text-3)">'+esc(k.created_by)+'</td><td style="color:var(--text-3)">'+fmtDate(k.created_at)+'</td><td style="text-align:right"><button class="btn-red-sm" onclick="deleteMcpKey(\\''+esc(k.key)+'\\',\\''+esc(k.name)+'\\')">Delete</button></td></tr>'});
  document.getElementById('mcp-keys-body').innerHTML=rows.length?rows.join(''):'<tr><td colspan="5" class="empty-state">No MCP keys yet. Create one to get started.</td></tr>';
}

// ── Helpers ──
function fmtDate(d){if(!d)return'-';var dt=new Date(d);return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}

function copyText(elId,btn){
  var text=document.getElementById(elId).textContent;
  navigator.clipboard.writeText(text).then(function(){
    btn.classList.add('copied');
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    setTimeout(function(){
      btn.classList.remove('copied');
      btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    },2000);
  });
}

// ── Create ──
function showCreateModal(mode){
  createMode=mode;
  document.getElementById('modal').classList.add('active');
  document.getElementById('modal-create').style.display='block';
  document.getElementById('modal-result').style.display='none';
  document.getElementById('key-name').value='';
  if(mode==='runner'){
    document.getElementById('modal-create-title').textContent='New Runner Key';
    document.getElementById('modal-create-desc').textContent='Create a new tenant with an API key for runner access.';
    document.getElementById('key-name').placeholder='e.g. andrew-laptop, ci-pipeline';
  }else{
    document.getElementById('modal-create-title').textContent='New MCP Key';
    document.getElementById('modal-create-desc').textContent='Create an API key for MCP service access (yt-mcp, etc).';
    document.getElementById('key-name').placeholder='e.g. obsidian-client, partner-acme';
  }
  document.getElementById('key-name').focus();
}

function hideModal(){document.getElementById('modal').classList.remove('active')}
document.getElementById('modal').addEventListener('click',function(e){if(e.target===e.currentTarget)hideModal()});

function createKey(){
  var name=document.getElementById('key-name').value.trim();
  if(!name)return;
  var btn=document.getElementById('create-btn');
  btn.innerHTML='<span class="spinner"></span> Creating...';btn.disabled=true;
  var url=createMode==='runner'?'/api/tokens':'/api/mcp-keys';
  fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})}).then(function(r){return r.json()}).then(function(data){
    if(data.error)throw new Error(data.error);
    document.getElementById('new-api-key').textContent=data.api_key||data.key;
    if(createMode==='runner'){
      document.getElementById('result-tenant-row').style.display='block';
      document.getElementById('new-tenant-id').textContent=data.id;
    }else{
      document.getElementById('result-tenant-row').style.display='none';
    }
    document.getElementById('modal-create').style.display='none';
    document.getElementById('modal-result').style.display='block';
  }).catch(function(e){alert('Failed: '+e.message)}).finally(function(){btn.innerHTML='Create';btn.disabled=false});
}

// ── Delete ──
function deleteTenant(id,name){
  if(!confirm('Delete runner key "'+name+'"? This cannot be undone.'))return;
  fetch('/api/tokens/'+id,{method:'DELETE'}).then(function(){loadAll()}).catch(function(e){alert('Failed: '+e.message)});
}

function deleteMcpKey(fullKey,name){
  if(!confirm('Delete MCP key "'+name+'"? This cannot be undone.'))return;
  fetch('/api/mcp-keys/'+fullKey,{method:'DELETE'}).then(function(){loadAll()}).catch(function(e){alert('Failed: '+e.message)});
}

// ── Domain-aware links ──
var DOMAIN='__DOMAIN__';
if(DOMAIN){document.getElementById('dash-endpoint').textContent='claude-runner.'+DOMAIN;document.getElementById('link-grafana').href='https://grafana.'+DOMAIN;document.getElementById('link-argocd').href='https://argocd.'+DOMAIN}

// ── Load all ──
function loadAll(){loadTokens();loadMcpKeys()}
loadAll();
</script>
</body>
</html>`;
