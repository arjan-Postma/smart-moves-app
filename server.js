// Combined static file server + Wix API proxy + analytics + publisher backend
// Listens on 0.0.0.0 so iPhone on same Wi-Fi can connect.
// Usage: node server.js   (run after: npm run build)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── API key ────────────────────────────────────────────────────────────────────
let API_KEY = process.env.EXPO_PUBLIC_WIX_API_KEY;
if (!API_KEY) {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    API_KEY = envFile.match(/EXPO_PUBLIC_WIX_API_KEY=(.+)/)?.[1]?.trim();
  } catch {}
}
// TODO: replace with Smart Moves Wix site values
const SITE_ID = 'YOUR_SMART_MOVES_SITE_ID';
const CATEGORY_ID = 'YOUR_SMART_MOVES_PARENT_CATEGORY_ID'; // "Smart Moves" parent
const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 8081;
// Publisher password — set PUBLISHER_KEY on Railway. If unset, any key works (dev mode).
const PUBLISHER_KEY = process.env.PUBLISHER_KEY || '';

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',   '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.wasm': 'application/wasm',
};

// ── SQLite database ────────────────────────────────────────────────────────────
let db = null;
try {
  const Database = require('better-sqlite3');
  const appDbPath = path.join(__dirname, 'analytics.db');
  const tmpDbPath = '/tmp/analytics.db';
  const dbPath = process.env.ANALYTICS_DB_PATH || (() => {
    try { fs.accessSync(path.dirname(appDbPath), fs.constants.W_OK); return appDbPath; } catch { return tmpDbPath; }
  })();
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT,
      device_id     TEXT,
      event_name    TEXT NOT NULL,
      card_id       TEXT,
      card_title    TEXT,
      card_category TEXT,
      collection_id TEXT,
      query         TEXT,
      platform      TEXT,
      ts            INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_event_name ON events(event_name);
    CREATE INDEX IF NOT EXISTS idx_ts         ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_device     ON events(device_id);
    CREATE INDEX IF NOT EXISTS idx_card       ON events(card_id);

    CREATE TABLE IF NOT EXISTS published_cards (
      card_id       TEXT PRIMARY KEY,
      title         TEXT,
      subtitle      TEXT,
      category      TEXT,
      image_url     TEXT,
      scheduled_for INTEGER,
      published_at  INTEGER,
      status        TEXT DEFAULT 'scheduled'
    );
    CREATE INDEX IF NOT EXISTS idx_pub_status ON published_cards(status);
  `);
  console.log('DB ready:', dbPath);
} catch (e) {
  console.warn('DB unavailable (analytics will be disabled):', e.message);
}

// ── Publisher JSON store (no native deps — works on any Node.js) ──────────────
const PUB_PATH = (() => {
  const p = path.join(__dirname, 'publisher_data.json');
  try { fs.accessSync(path.dirname(p), fs.constants.W_OK); return p; } catch { return '/tmp/publisher_data.json'; }
})();
console.log('Publisher store:', PUB_PATH);

function pubRead() {
  try { return JSON.parse(fs.readFileSync(PUB_PATH, 'utf8')); } catch { return { cards: {} }; }
}
function pubWrite(data) { fs.writeFileSync(PUB_PATH, JSON.stringify(data)); }
function pubAll() { return Object.values(pubRead().cards); }
function pubUpsert(cardData) {
  const data = pubRead();
  data.cards[cardData.card_id] = { ...(data.cards[cardData.card_id] || {}), ...cardData };
  pubWrite(data);
  return data.cards[cardData.card_id];
}
function pubDelete(cardId) { const data = pubRead(); delete data.cards[cardId]; pubWrite(data); }

// Archive/app settings stored alongside publisher cards
function getSettings() {
  const data = pubRead();
  return { archive_days: 90, ...(data.settings || {}) };
}
function saveSettings(s) {
  const data = pubRead();
  data.settings = { ...(data.settings || {}), ...s };
  pubWrite(data);
}

// ── Scheduler: promote due scheduled cards to published ───────────────────────
function runScheduler() {
  const now = Math.floor(Date.now() / 1000);
  // JSON store scheduler
  try {
    const data = pubRead();
    let changed = 0;
    Object.values(data.cards).forEach(c => {
      if (c.status === 'scheduled' && c.scheduled_for && c.scheduled_for <= now) {
        c.status = 'published'; c.published_at = now; changed++;
      }
    });
    if (changed > 0) { pubWrite(data); console.log(`Scheduler: ${changed} card(s) published`); }
  } catch(e) { console.warn('Scheduler error:', e.message); }
  // SQLite scheduler (analytics DB) — optional
  if (db) {
    try {
      db.prepare(`UPDATE published_cards SET status='published', published_at=? WHERE status='scheduled' AND scheduled_for IS NOT NULL AND scheduled_for<=?`).run(now, now);
    } catch(e) {}
  }
}

runScheduler();
setInterval(runScheduler, 5 * 60 * 1000);

// ── Wix HTTP helper ────────────────────────────────────────────────────────────
function wixPost(wixPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'www.wixapis.com',
        path: wixPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          Authorization: API_KEY,
          'wix-site-id': SITE_ID,
        },
      },
      (r) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Fetch every Wix card (all pages) — used by publisher panel
async function fetchAllWixCards() {
  // Fetch category names first (id → label map)
  const catMap = {};
  try {
    const catData = await wixPost('/blog/v3/categories/query', { query: { paging: { limit: 100 } } });
    (catData.categories || []).forEach(c => { catMap[c.id] = c.label || c.title || ''; });
  } catch(e) { console.warn('Category fetch failed:', e.message); }

  const allPosts = [];
  let cursor = null;
  let page = 0;
  do {
    const body = {
      query: {
        filter: { categoryIds: { $hasSome: [CATEGORY_ID] } },
        sort: [{ fieldName: 'firstPublishedDate', order: 'DESC' }],
        ...(cursor ? { cursorPaging: { cursor } } : { paging: { limit: 100 } }),
      },
      fieldsets: ['URL', 'CONTENT_TEXT'],
    };
    const data = await wixPost('/blog/v3/posts/query', body);
    // Attach resolved category names
    (data.posts || []).forEach(p => { p._catMap = catMap; });
    allPosts.push(...(data.posts || []));
    cursor = data.pagingMetadata?.cursors?.next;
    page++;
  } while (cursor && page < 20);
  return allPosts;
}

// ── Publisher auth check ───────────────────────────────────────────────────────
function checkPublisherKey(req) {
  if (!PUBLISHER_KEY) return true; // dev mode — no key set
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const header = req.headers['x-publisher-key'] || '';
  return qs.get('key') === PUBLISHER_KEY || header === PUBLISHER_KEY;
}

// ── Events JSON store (no native deps) ────────────────────────────────────────
const EVENTS_PATH = (() => {
  const p = path.join(__dirname, 'events_data.json');
  try { fs.accessSync(path.dirname(p), fs.constants.W_OK); return p; } catch { return '/tmp/events_data.json'; }
})();
console.log('Events store:', EVENTS_PATH);

function eventsRead() {
  try { return JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8')); } catch { return []; }
}
function eventsAppend(event) {
  const events = eventsRead();
  events.push(event);
  // Keep only last 50 000 events to cap file size
  const trimmed = events.length > 50000 ? events.slice(-50000) : events;
  try { fs.writeFileSync(EVENTS_PATH, JSON.stringify(trimmed)); } catch {}
}

// ── Stats helpers ──────────────────────────────────────────────────────────────
function periodStart(period) {
  const now = new Date();
  switch (period) {
    case 'today': return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    case 'month': return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    case 'ytd':   return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
    default: return 0;
  }
}

function computeStats(period) {
  const since = periodStart(period);
  const allEvents = eventsRead();
  const events = since > 0 ? allEvents.filter(e => (e.ts || 0) >= since) : allEvents;

  const count = (name) => events.filter(e => e.event_name === name).length;

  const uniqueSet = (name, field) => {
    const s = new Set();
    events.forEach(e => { if (e.event_name === name && e[field]) s.add(e[field]); });
    return s.size;
  };

  const summary = {
    sessions:          uniqueSet('app_open', 'session_id'),
    uniqueVisitors:    new Set(events.map(e => e.device_id).filter(Boolean)).size,
    cardViews:         count('card_view'),
    likes:             count('card_like'),
    collectionAdds:    count('collection_add'),
    collectionShares:  count('collection_share'),
    collectionImports: count('collection_import'),
    relatedClicks:     count('card_related'),
  };

  const topN = (eventName, field, label, n = 10) => {
    const counts = {};
    events.forEach(e => {
      if (e.event_name === eventName && e[field]) counts[e[field]] = (counts[e[field]] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([val, count]) => ({ [label]: val, count }));
  };

  // Daily activity — last 30 days
  const cutoff30 = Math.floor(Date.now() / 1000) - 30 * 86400;
  const dailyMap = {};
  allEvents.filter(e => (e.ts || 0) >= cutoff30).forEach(e => {
    const d = new Date(e.ts * 1000);
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!dailyMap[date]) dailyMap[date] = { date, sessions: new Set(), views: 0 };
    if (e.event_name === 'app_open' && e.session_id) dailyMap[date].sessions.add(e.session_id);
    if (e.event_name === 'card_view') dailyMap[date].views++;
  });
  const dailyActivity = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, sessions, views }) => ({ date, sessions: sessions.size, views }));

  return {
    period, summary,
    topViewedCards:    topN('card_view',      'card_title', 'cardTitle'),
    topLikedCards:     topN('card_like',      'card_title', 'cardTitle'),
    topCollectedCards: topN('collection_add', 'card_title', 'cardTitle'),
    topSearchQueries:  topN('search',         'query',      'query'),
    dailyActivity,
  };
}

// ── Shared CSS variables ───────────────────────────────────────────────────────
const SHARED_CSS = `
  :root {
    --bg:#0d0f16; --surface:#161927; --surface2:#1e2235; --accent:#FE0437;
    --text:#e8eaf2; --muted:#7c84a0; --border:#252840;
    --green:#22c55e; --yellow:#f59e0b; --grey:#4b5563;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;
    border-bottom:1px solid var(--border);background:var(--surface);z-index:10;flex-wrap:wrap;gap:12px;flex-shrink:0}
  .header-left{display:flex;align-items:center;gap:14px}
  .fa-logo{height:40px;width:40px;object-fit:contain;border-radius:5px;flex-shrink:0}
  .logo-divider{width:1px;height:28px;background:var(--border);flex-shrink:0}
  .logo{display:flex;align-items:center;gap:10px}
  .logo-dot{width:9px;height:9px;border-radius:50%;background:var(--accent);flex-shrink:0}
  .logo h1{font-size:17px;font-weight:700;letter-spacing:-.2px}
  .logo-sub{font-size:11px;color:var(--muted);margin-top:2px}
  .nav-tabs{display:flex;gap:4px}
  .nav-tab{padding:7px 16px;border-radius:8px;border:1px solid var(--border);
    background:transparent;color:var(--muted);cursor:pointer;font-size:13px;font-weight:500;
    text-decoration:none;transition:all .12s}
  .nav-tab:hover{border-color:var(--accent);color:var(--text)}
  .nav-tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .main{padding:28px;max-width:1440px;margin:0 auto}
  .empty{padding:32px 20px;text-align:center;color:var(--muted);font-size:13px}
  .loading-msg{text-align:center;padding:80px 20px;color:var(--muted);font-size:15px}
  input,select,button{font-family:inherit}
`;

// ── Analytics dashboard HTML ───────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMART MOVES Analytics</title>
<style>
${SHARED_CSS}
.period-selector{display:flex;gap:6px;flex-wrap:wrap}
.period-btn{padding:7px 15px;border-radius:8px;border:1px solid var(--border);
  background:transparent;color:var(--muted);cursor:pointer;font-size:13px;font-weight:500;transition:all .12s}
.period-btn:hover{border-color:var(--accent);color:var(--text)}
.period-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
#last-updated{color:var(--muted);font-size:12px;margin-top:2px}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:14px;margin-bottom:28px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px 20px}
.stat-card .label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.9px;margin-bottom:10px}
.stat-card .value{font-size:34px;font-weight:700;letter-spacing:-1.5px;line-height:1}
.stat-card .value.accent{color:var(--accent)}
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px 24px;margin-bottom:20px;overflow:hidden}
.chart-card h3{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.9px;margin-bottom:18px}
.chart{display:flex;align-items:flex-end;gap:3px;height:100px;overflow:hidden}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}
.bar-wrap{width:100%;flex:1;display:flex;align-items:flex-end}
.bar{width:100%;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;opacity:.75;transition:opacity .15s;cursor:default}
.bar:hover{opacity:1}
.bar-label{font-size:8px;color:var(--muted);white-space:nowrap;transform:rotate(-55deg);transform-origin:center}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:780px){.grid-2{grid-template-columns:1fr}}
.table-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.table-card h3{padding:16px 20px 13px;font-size:12px;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:.9px;border-bottom:1px solid var(--border)}
table{width:100%;border-collapse:collapse}
td{padding:11px 20px;font-size:13px;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surface2)}
.td-rank{color:var(--muted);font-weight:700;width:32px;font-size:12px}
.td-count{text-align:right;font-weight:700;font-size:14px;color:var(--accent);white-space:nowrap}
.td-title{word-break:break-word}
</style></head><body>
<div class="header">
  <div class="header-left">
    <img src="/assets/futures-academy-logo.png" class="fa-logo" alt="Futures Academy">
    <div class="logo-divider"></div>
    <div class="logo"><div class="logo-dot"></div><div>
      <h1>SMART MOVES</h1><div id="last-updated" class="logo-sub">Loading…</div>
    </div></div>
  </div>
  <div class="period-selector">
    <button class="period-btn active" data-period="today">Today</button>
    <button class="period-btn" data-period="month">This Month</button>
    <button class="period-btn" data-period="ytd">Year to Date</button>
    <button class="period-btn" data-period="all">All Time</button>
  </div>
  <div class="nav-tabs">
    <a class="nav-tab active" href="/stats">Analytics</a>
    <a class="nav-tab" href="/publisher">Publisher</a>
  </div>
</div>
<div class="main" id="main"><div class="loading-msg">Loading analytics…</div></div>
<script>
let currentPeriod='today';
document.querySelectorAll('.period-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod=btn.dataset.period;
    loadStats();
  });
});
async function loadStats(){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),12000);
  try{
    const res=await fetch('/api/stats?period='+currentPeriod,{signal:ctrl.signal});
    clearTimeout(t);
    const text=await res.text();
    if(!res.ok) throw new Error('Server returned '+res.status+(text?' — '+text.slice(0,120):''));
    render(JSON.parse(text));
  }catch(e){
    clearTimeout(t);
    const msg=e.name==='AbortError'?'Request timed out — server may be starting up':e.message;
    document.getElementById('main').innerHTML='<div class="loading-msg">&#9888; '+msg+'<br><br><button onclick="loadStats()" style="margin-top:8px;padding:7px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">Retry</button></div>';
  }
}
function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n)}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function table(rows,keyProp){
  if(!rows||!rows.length)return '<div class="empty">No data yet</div>';
  return '<table>'+rows.map((r,i)=>\`<tr><td class="td-rank">#\${i+1}</td><td class="td-title">\${esc(r[keyProp]||'—')}</td><td class="td-count">\${r.count}</td></tr>\`).join('')+'</table>';
}
function chart(days){
  if(!days||!days.length)return '<div class="empty">No data yet</div>';
  const max=Math.max(...days.map(d=>d.sessions),1);
  return '<div class="chart">'+days.map(d=>\`<div class="bar-col" title="\${d.date}: \${d.sessions} sessions"><div class="bar-wrap"><div class="bar" style="height:\${Math.max(2,Math.round(d.sessions/max*96))}px"></div></div><div class="bar-label">\${d.date.slice(5)}</div></div>\`).join('')+'</div>';
}
function render(d){
  const s=d.summary;
  const labels={today:'Today',month:'This Month',ytd:'Year to Date',all:'All Time'};
  document.getElementById('last-updated').textContent=labels[currentPeriod]+' · '+new Date().toLocaleTimeString();
  document.getElementById('main').innerHTML=\`
    <div class="summary-grid">
      <div class="stat-card"><div class="label">Sessions</div><div class="value">\${fmt(s.sessions)}</div></div>
      <div class="stat-card"><div class="label">Unique Visitors</div><div class="value">\${fmt(s.uniqueVisitors)}</div></div>
      <div class="stat-card"><div class="label">Card Views</div><div class="value accent">\${fmt(s.cardViews)}</div></div>
      <div class="stat-card"><div class="label">Likes</div><div class="value">\${fmt(s.likes)}</div></div>
      <div class="stat-card"><div class="label">Collection Adds</div><div class="value">\${fmt(s.collectionAdds)}</div></div>
      <div class="stat-card"><div class="label">Shares</div><div class="value">\${fmt(s.collectionShares)}</div></div>
      <div class="stat-card"><div class="label">Imports</div><div class="value">\${fmt(s.collectionImports)}</div></div>
      <div class="stat-card"><div class="label">Related Clicks</div><div class="value">\${fmt(s.relatedClicks)}</div></div>
    </div>
    <div class="chart-card"><h3>Daily Sessions — Last 30 Days</h3>\${chart(d.dailyActivity)}</div>
    <div class="grid-2">
      <div class="table-card"><h3>Most Viewed Trends</h3>\${table(d.topViewedCards,'cardTitle')}</div>
      <div class="table-card"><h3>Most Liked Trends</h3>\${table(d.topLikedCards,'cardTitle')}</div>
    </div>
    <div class="grid-2">
      <div class="table-card"><h3>Most Added to Collections</h3>\${table(d.topCollectedCards,'cardTitle')}</div>
      <div class="table-card"><h3>Top Search Keywords</h3>\${table(d.topSearchQueries,'query')}</div>
    </div>
  \`;
}
loadStats();
setInterval(loadStats,60000);
// Restore publisher link with saved key
(function(){ const k=sessionStorage.getItem('pubKey'); if(k) document.querySelectorAll('a[href="/publisher"]').forEach(a=>a.href='/publisher?key='+encodeURIComponent(k)); })();
</script></body></html>`;

// ── Publisher HTML ─────────────────────────────────────────────────────────────
const PUBLISHER_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMART MOVES Publisher</title>
<style>
${SHARED_CSS}
/* App shell */
html,body{height:100%;overflow:hidden;display:flex;flex-direction:column}
.body-row{flex:1;display:flex;overflow:hidden}
/* ── Sidebar (col 1: calendar only) ── */
.sidebar{width:270px;flex-shrink:0;display:flex;flex-direction:column;overflow-y:auto;
  border-right:1px solid var(--border);background:var(--surface)}
.cal-section{padding:14px 12px 12px}
.cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cal-nav{background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;
  padding:2px 8px;line-height:1;border-radius:6px;transition:background .1s}
.cal-nav:hover{background:var(--surface2)}
.cal-month{font-size:14px;font-weight:700;color:var(--text);letter-spacing:.3px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}
.cal-weekday{font-size:9px;font-weight:600;color:var(--muted);text-align:center;padding:3px 0;letter-spacing:.4px}
.cal-day{min-height:32px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);transition:background .1s}
.cal-day:hover{background:var(--surface2)}
.cal-day.other-month{color:var(--muted);opacity:.3;pointer-events:none}
.cal-day.today{border:1.5px solid var(--accent);color:var(--accent);font-weight:700}
.cal-day.selected{background:var(--accent)!important;color:#fff!important;font-weight:700}
.cal-day.selected .day-dot{background:rgba(255,255,255,.7)!important}
.day-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:2px;flex-shrink:0}
/* ── Date panel (col 2: always visible) ── */
.date-panel{width:280px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden;
  border-right:1px solid var(--border);background:var(--surface)}
.date-panel-hdr{padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
.date-panel-title{font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.3px;display:block;margin-bottom:2px}
.date-panel-hint{font-size:10px;color:var(--muted)}
.date-panel-list{flex:1;overflow-y:auto}
.dp-row{display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid var(--border)}
.dp-thumb{width:48px;height:48px;object-fit:cover;border-radius:5px;flex-shrink:0;background:var(--surface2)}
.dp-thumb-empty{width:48px;height:48px;border-radius:5px;background:var(--surface2);flex-shrink:0}
.dp-title{font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.3px;
  margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-sub{font-size:10px;color:var(--muted);line-height:1.35;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dp-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:11px;line-height:1.6}
.dp-del{flex-shrink:0;background:none;border:none;cursor:pointer;font-size:14px;opacity:.45;padding:4px;line-height:1;border-radius:5px;transition:opacity .12s}
.dp-del:hover{opacity:1}
/* ── Main list column (col 3) ── */
.main-col{flex:1;min-width:260px;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)}
/* List header — sticky above the scroll list */
.list-header{flex-shrink:0;padding:10px 12px;background:var(--surface);
  border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
.sort-row{display:flex;gap:5px;flex-wrap:nowrap;align-items:center}
.sort-btn{height:28px;padding:0 11px;border-radius:14px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer;
  letter-spacing:.3px;transition:all .12s;white-space:nowrap}
.sort-btn:hover{border-color:var(--muted);color:var(--text)}
.sort-btn.active{background:var(--surface2);border-color:var(--text);color:var(--text)}
.sort-btn.has-filter{background:var(--accent)!important;border-color:var(--accent)!important;color:#fff!important}
.sub-filter{display:flex;flex-wrap:wrap;gap:4px}
.chip{height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:10px;font-weight:600;cursor:pointer;
  white-space:nowrap;transition:all .12s}
.chip:hover{border-color:var(--muted);color:var(--text)}
.chip.active{background:var(--accent);border-color:var(--accent);color:#fff}
.sort-search{flex:1;min-width:80px;height:28px;background:var(--bg);border:1px solid var(--border);
  border-radius:14px;padding:0 10px;color:var(--text);font-size:12px;outline:none}
.sort-search:focus{border-color:var(--accent)}
/* Scrollable list body */
.list-body{flex:1;overflow-y:auto}
.trend-list{list-style:none}
.trend-row{display:flex;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border);
  background:var(--surface);gap:9px;transition:background .1s}
.trend-row:hover{background:var(--surface2)}
.trend-check{font-size:24px;color:#fff;cursor:pointer;user-select:none;flex-shrink:0;
  width:28px;text-align:center;line-height:1}
.trend-check.published{color:var(--green);cursor:default}
.trend-check.dimmed{color:var(--border);cursor:default;opacity:.4}
.trend-photo-col{display:flex;flex-direction:column;align-items:flex-start;flex-shrink:0;width:68px;gap:4px}
.trend-thumb{width:68px;height:68px;object-fit:cover;border-radius:6px;display:block;background:var(--surface2)}
.trend-thumb-empty{width:68px;height:68px;border-radius:6px;background:var(--surface2)}
.trend-status{display:flex;align-items:center;gap:4px}
.status-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.status-text{font-size:9px;color:var(--muted);white-space:nowrap}
.trend-content{flex:1;min-width:0}
.trend-title{font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.3px;
  margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trend-subtitle{font-size:11px;color:var(--muted);line-height:1.4;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.trend-edit-btn{width:20px;height:16px;border-radius:4px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:10px;cursor:pointer;display:flex;
  align-items:center;justify-content:center;transition:all .12s;padding:0;line-height:1}
.trend-edit-btn:hover{border-color:var(--muted);color:var(--text)}
.edit-panel{display:none;background:var(--surface2);border-bottom:1px solid var(--border);
  padding:10px 14px 12px;gap:8px;flex-wrap:wrap;align-items:center}
.edit-panel.open{display:flex}
.edit-label{font-size:10px;font-weight:600;color:var(--muted);letter-spacing:.4px;text-transform:uppercase}
.edit-date-input{height:30px;background:var(--bg);border:1px solid var(--border);border-radius:7px;
  padding:0 9px;color:var(--text);font-size:12px;outline:none;cursor:pointer}
.edit-date-input:focus{border-color:var(--accent)}
.btn{height:28px;padding:0 12px;border-radius:7px;border:none;font-size:11px;font-weight:600;
  cursor:pointer;letter-spacing:.3px;transition:opacity .15s;white-space:nowrap}
.btn:hover{opacity:.85}
.btn-primary{background:var(--accent);color:#fff}
.btn-outline{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-outline:hover{border-color:var(--muted);color:var(--text)}
.btn-danger{background:transparent;color:#ef4444;border:1px solid #ef444433;height:28px;padding:0 12px;
  border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn-danger:hover{background:#ef444420}
/* ── Badges ── */
.counts{display:flex;gap:8px;align-items:center}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:.4px;white-space:nowrap}
.badge-green{background:rgba(34,197,94,.15);color:var(--green)}
.badge-yellow{background:rgba(245,158,11,.15);color:var(--yellow)}
.badge-grey{background:rgba(75,85,99,.25);color:#9ca3af}
#loading{position:fixed;inset:0;background:rgba(13,15,22,.92);display:flex;align-items:center;
  justify-content:center;font-size:15px;color:var(--muted);z-index:100}
.badge-archive{background:rgba(156,163,175,.18);color:#9ca3af}
.archive-section{padding:12px 12px 14px;border-bottom:1px solid var(--border)}
.archive-section-title{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px}
.archive-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.archive-days-input{width:56px;height:28px;background:var(--bg);border:1px solid var(--border);border-radius:7px;
  padding:0 8px;color:var(--text);font-size:13px;text-align:center;outline:none;font-family:inherit}
.archive-days-input:focus{border-color:var(--accent)}
.archive-hint{font-size:10px;color:var(--muted);line-height:1.5;margin-top:6px}
.status-archived{color:#9ca3af}
</style></head><body>
<div id="loading">Loading all trends from Wix…</div>

<div class="header">
  <div class="header-left">
    <img src="/assets/futures-academy-logo.png" class="fa-logo" alt="Futures Academy">
    <div class="logo-divider"></div>
    <div class="logo"><div class="logo-dot"></div>
      <div><h1>SMART MOVES</h1><div class="logo-sub">Publisher</div></div>
    </div>
  </div>
  <div class="counts">
    <span class="badge badge-green"   id="cnt-published">0 live</span>
    <span class="badge badge-archive" id="cnt-archived">0 archived</span>
    <span class="badge badge-yellow"  id="cnt-scheduled">0 scheduled</span>
    <span class="badge badge-grey"    id="cnt-available">0 available</span>
  </div>
  <div class="nav-tabs">
    <a class="nav-tab" href="/stats">Analytics</a>
    <a class="nav-tab active" href="/publisher">Publisher</a>
  </div>
</div>

<div class="body-row">

  <!-- Col 1: Calendar -->
  <div class="sidebar">
    <!-- Archive settings -->
    <div class="archive-section">
      <div class="archive-section-title">Archive settings</div>
      <div class="archive-row">
        <span style="font-size:11px;color:var(--muted)">After</span>
        <input type="number" class="archive-days-input" id="archive-days-input" min="1" max="3650" value="90">
        <span style="font-size:11px;color:var(--muted)">days</span>
        <button class="btn btn-primary" onclick="saveArchiveSettings()" style="height:28px">Save</button>
      </div>
      <div class="archive-hint" id="archive-hint">Cards published more than <b id="archive-days-label">90</b> days ago move to Archive in the app</div>
    </div>
    <div class="cal-section">
      <div class="cal-header">
        <button class="cal-nav" onclick="shiftMonth(-1)">&#8249;</button>
        <span class="cal-month" id="cal-month-label"></span>
        <button class="cal-nav" onclick="shiftMonth(1)">&#8250;</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
    </div>
  </div>

  <!-- Col 2: Scheduled for selected date (always visible) -->
  <div class="date-panel" id="date-panel">
    <div class="date-panel-hdr">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <button class="cal-nav" onclick="shiftDay(-1)" title="Previous day">&#8249;</button>
        <span class="date-panel-title" id="dp-title">Scheduled</span>
        <button class="cal-nav" onclick="shiftDay(1)" title="Next day">&#8250;</button>
      </div>
      <span class="date-panel-hint" id="dp-hint">Select a date in the calendar</span>
    </div>
    <div class="date-panel-list" id="dp-list">
      <div class="dp-empty">&#8592; Click a date to see what&#8217;s scheduled</div>
    </div>
  </div>

  <!-- Col 3: Full trend list with sticky header -->
  <div class="main-col">
    <div class="list-header">
      <div class="sort-row">
        <button class="sort-btn"        id="sb-state"    onclick="setSort('state')"   >State</button>
        <button class="sort-btn"        id="sb-alpha"    onclick="setSort('alpha')"   >A&#8594;Z</button>
        <button class="sort-btn active" id="sb-recent"   onclick="setSort('recent')"  >Recent &#8595;</button>
        <button class="sort-btn"        id="sb-category" onclick="setSort('category')">Category</button>
        <input class="sort-search" id="search" placeholder="Search…" oninput="renderList()">
      </div>
      <div id="sub-state" class="sub-filter" style="display:none">
        <button class="chip active" id="sf-all"       onclick="setFilterState('all')"      >All</button>
        <button class="chip"        id="sf-available" onclick="setFilterState('available')" >Not scheduled</button>
        <button class="chip"        id="sf-scheduled" onclick="setFilterState('scheduled')" >Scheduled</button>
        <button class="chip"        id="sf-published" onclick="setFilterState('published')" >Published</button>
        <button class="chip"        id="sf-archived"  onclick="setFilterState('archived')"  >Archived</button>
      </div>
      <div id="sub-category" class="sub-filter" style="display:none"></div>
    </div>
    <div class="list-body">
      <ul class="trend-list" id="list"></ul>
    </div>
  </div>

</div>

<script>
const KEY = new URLSearchParams(location.search).get('key') || '';
if(KEY) sessionStorage.setItem('pubKey', KEY);
let allCards = [];
let pubMap = {};
let originalOrder = {};
let selectedDate = null;
let sortMode = 'recent';
let alphaDir  = 1;
let recentDir = 1;
let filterState = 'all';
let filterCat   = '';
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let archiveDays = 90; // loaded from settings

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['M','T','W','T','F','S','S'];

function apiHeaders(){ return {'Content-Type':'application/json','x-publisher-key':KEY}; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(ts){ if(!ts)return''; return new Date(ts*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function tsToISO(ts){ if(!ts)return''; return new Date(ts*1000).toISOString().slice(0,10); }
function isoToTS(iso){ return Math.floor(new Date(iso+'T09:00:00').getTime()/1000); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function isArchived(card){
  const p=pubMap[card.id];
  if(!p||p.status!=='published'||!p.published_at) return false;
  const cutoff=Math.floor(Date.now()/1000)-(archiveDays*86400);
  return p.published_at<=cutoff;
}
function getStatus(card){
  const p=pubMap[card.id];
  if(!p) return 'available';
  if(p.status==='published'&&isArchived(card)) return 'archived';
  return p.status;
}

// ── Archive settings ──────────────────────────────────────────────────────────
async function loadSettings(){
  try{
    const r=await fetch('/api/publisher/settings?key='+encodeURIComponent(KEY));
    if(r.ok){
      const s=await r.json();
      archiveDays=s.archive_days||90;
      document.getElementById('archive-days-input').value=archiveDays;
      document.getElementById('archive-days-label').textContent=archiveDays;
    }
  }catch(e){ console.warn('Settings load failed',e); }
}
async function saveArchiveSettings(){
  const v=parseInt(document.getElementById('archive-days-input').value,10);
  if(!v||v<1||v>3650){alert('Please enter a number between 1 and 3650');return;}
  try{
    const r=await fetch('/api/publisher/settings?key='+encodeURIComponent(KEY),{
      method:'POST',headers:apiHeaders(),body:JSON.stringify({archive_days:v}),
    });
    if(!r.ok){alert('Save error: '+(await r.text()));return;}
    archiveDays=v;
    document.getElementById('archive-days-label').textContent=v;
    renderList();
  }catch(e){alert('Network error: '+e.message);}
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function load(){
  try{
    const [wixRes,pubRes] = await Promise.all([
      fetch('/api/publisher/wix-all?key='+encodeURIComponent(KEY)),
      fetch('/api/publisher/list?key='+encodeURIComponent(KEY)),
    ]);
    if(wixRes.status===403){document.getElementById('loading').textContent='Access denied'; return;}
    const wixData=await wixRes.json(), pubData=await pubRes.json();
    allCards=wixData.cards||[];
    allCards.forEach((c,i)=>originalOrder[c.id]=i);
    pubMap={};
    (pubData.cards||[]).forEach(c=>pubMap[c.card_id]=c);

    const cats=[...new Set(allCards.map(c=>c.category).filter(Boolean))].sort();
    const catEl=document.getElementById('sub-category');
    catEl.innerHTML='<button class="chip active" data-cat="" onclick="setFilterCat(this)">All</button>'
      +cats.map(cat=>\`<button class="chip" data-cat="\${esc(cat)}" onclick="setFilterCat(this)">\${esc(cat)}</button>\`).join('');

    await loadSettings();
    renderCalendar();
    renderList();
  }catch(e){
    document.getElementById('loading').textContent='Failed: '+e.message; return;
  }
  document.getElementById('loading').style.display='none';
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function scheduledDates(){
  const s=new Set();
  Object.values(pubMap).forEach(p=>{if(p.status==='scheduled'&&p.scheduled_for)s.add(tsToISO(p.scheduled_for));});
  return s;
}
function renderCalendar(){
  document.getElementById('cal-month-label').textContent=MONTH_NAMES[calMonth]+' '+calYear;
  const today=todayISO(), sched=scheduledDates();
  let html=WEEKDAYS.map(d=>\`<div class="cal-weekday">\${d}</div>\`).join('');
  const first=new Date(calYear,calMonth,1);
  let offset=first.getDay()-1; if(offset<0)offset=6;
  const dim=new Date(calYear,calMonth+1,0).getDate();
  for(let i=0;i<offset;i++) html+='<div class="cal-day other-month"></div>';
  for(let d=1;d<=dim;d++){
    const iso=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const cls=['cal-day'];
    if(iso===today) cls.push('today');
    if(iso===selectedDate) cls.push('selected');
    const dot=sched.has(iso)?'<div class="day-dot"></div>':'';
    html+=\`<div class="\${cls.join(' ')}" onclick="selectDate('\${iso}')">\${d}\${dot}</div>\`;
  }
  const rem=(offset+dim)%7;
  if(rem>0) for(let i=rem;i<7;i++) html+='<div class="cal-day other-month"></div>';
  document.getElementById('cal-grid').innerHTML=html;
}
function shiftMonth(d){
  calMonth+=d;
  if(calMonth<0){calMonth=11;calYear--;}
  if(calMonth>11){calMonth=0;calYear++;}
  renderCalendar();
}
function selectDate(iso){
  selectedDate=(selectedDate===iso)?null:iso;
  renderCalendar();
  renderList();
  updateDatePanel();
}
function shiftDay(d){
  const base = selectedDate || todayISO();
  const dt = new Date(base + 'T12:00:00');
  dt.setDate(dt.getDate() + d);
  selectedDate = dt.toISOString().slice(0,10);
  const [y,m] = selectedDate.split('-').map(Number);
  if(y !== calYear || m-1 !== calMonth){ calYear=y; calMonth=m-1; }
  renderCalendar();
  renderList();
  updateDatePanel();
}

// ── Sort / filter ─────────────────────────────────────────────────────────────
function setSort(mode){
  if(mode===sortMode){
    if(mode==='alpha') alphaDir*=-1;
    if(mode==='recent') recentDir*=-1;
  } else { sortMode=mode; alphaDir=1; recentDir=1; }
  ['state','alpha','recent','category'].forEach(m=>document.getElementById('sb-'+m).classList.toggle('active',m===sortMode));
  document.getElementById('sb-alpha').textContent  = alphaDir===1  ? 'A\u2192Z' : 'Z\u2192A';
  document.getElementById('sb-recent').textContent = recentDir===1 ? 'Recent \u2193' : 'Recent \u2191';
  document.getElementById('sub-state').style.display    = sortMode==='state'    ? 'flex' : 'none';
  document.getElementById('sub-category').style.display = sortMode==='category' ? 'flex' : 'none';
  renderList();
}
function setFilterState(s){
  filterState=s;
  ['all','available','scheduled','published','archived'].forEach(v=>{
    const el=document.getElementById('sf-'+v);
    if(el) el.classList.toggle('active',v===s);
  });
  document.getElementById('sb-state').classList.toggle('has-filter', s!=='all');
  renderList();
}
function setFilterCat(btn){
  filterCat=btn.dataset.cat||'';
  document.querySelectorAll('#sub-category .chip').forEach(el=>el.classList.toggle('active',el===btn));
  document.getElementById('sb-category').classList.toggle('has-filter', filterCat!=='');
  renderList();
}

// ── List ──────────────────────────────────────────────────────────────────────
function renderList(){
  const q=document.getElementById('search').value.toLowerCase();
  let pub=0,arc=0,sch=0,av=0;
  allCards.forEach(c=>{
    const s=getStatus(c);
    if(s==='published')pub++;
    else if(s==='archived')arc++;
    else if(s==='scheduled')sch++;
    else av++;
  });
  document.getElementById('cnt-published').textContent=pub+' live';
  document.getElementById('cnt-archived').textContent=arc+' archived';
  document.getElementById('cnt-scheduled').textContent=sch+' scheduled';
  document.getElementById('cnt-available').textContent=av+' available';

  let cards=allCards.filter(c=>{
    if(q&&!c.title.toLowerCase().includes(q)&&!(c.subtitle||'').toLowerCase().includes(q)) return false;
    const s=getStatus(c);
    if(filterState!=='all'&&s!==filterState) return false;
    if(filterCat&&c.category!==filterCat) return false;
    return true;
  });

  const ord={published:0,archived:1,scheduled:2,available:3};
  if(sortMode==='state')        cards.sort((a,b)=>(ord[getStatus(a)]??9)-(ord[getStatus(b)]??9));
  else if(sortMode==='alpha')   cards.sort((a,b)=>alphaDir*a.title.localeCompare(b.title));
  else if(sortMode==='recent')  cards.sort((a,b)=>recentDir*(originalOrder[a.id]-originalOrder[b.id]));
  else if(sortMode==='category')cards.sort((a,b)=>(a.category||'').localeCompare(b.category||''));

  document.getElementById('list').innerHTML=cards.length
    ? cards.map(c=>rowHTML(c)).join('')
    : '<li style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No trends match</li>';
}

function rowHTML(c){
  const status=getStatus(c);
  const p=pubMap[c.id];
  const schedISO=(status==='scheduled'&&p?.scheduled_for)?tsToISO(p.scheduled_for):null;
  const isChecked=(status==='published'||status==='archived')||(status==='scheduled'&&selectedDate&&schedISO===selectedDate);
  let checkCls='trend-check';
  let checkClick='';
  if(status==='published'||status==='archived'){ checkCls+=' published'; }
  else if(selectedDate)        { checkClick=\`onclick="toggleCheck('\${esc(c.id)}')"\`; }
  else                         { checkCls+=' dimmed'; }

  let dotColor='#4b5563', statusLabel='Not scheduled';
  if(status==='published'){dotColor='#22c55e';statusLabel='Live'+(p?.published_at?' '+fmtDate(p.published_at):'');}
  else if(status==='archived'){dotColor='#6b7280';statusLabel='Archived'+(p?.published_at?' '+fmtDate(p.published_at):'');}
  else if(status==='scheduled'&&schedISO){dotColor='#f59e0b';statusLabel=fmtDate(p.scheduled_for);}

  const img=c.imageUrl
    ?\`<img class="trend-thumb" src="\${esc(c.imageUrl)}" alt="" loading="lazy">\`
    :'<div class="trend-thumb-empty"></div>';

  const titleCls=status==='archived'?'trend-title status-archived':'trend-title';

  return \`<li>
  <div class="trend-row" id="row-\${esc(c.id)}">
    <span class="\${checkCls}" \${checkClick}>\${isChecked?'&#9745;':'&#9744;'}</span>
    <div class="trend-photo-col">
      \${img}
      <div class="trend-status">
        <div class="status-dot" style="background:\${dotColor}"></div>
        <span class="status-text\${status==='archived'?' status-archived':''}">\${esc(statusLabel)}</span>
      </div>
    </div>
    <div class="trend-content">
      <div style="margin-bottom:2px">
        <button class="trend-edit-btn" onclick="toggleEdit('\${esc(c.id)}')" title="Edit">&#9998;</button>
      </div>
      <div class="\${titleCls}">\${esc(c.title)}</div>
      <div class="trend-subtitle">\${esc(c.subtitle||'')}</div>
    </div>
  </div>
  <div class="edit-panel" id="edit-\${esc(c.id)}">
    <span class="edit-label">Date</span>
    <input class="edit-date-input" type="date" id="dt-\${esc(c.id)}" value="\${schedISO||todayISO()}">
    <button class="btn btn-primary" onclick="saveEdit('\${esc(c.id)}')">Schedule</button>
    <button class="btn btn-outline" onclick="publishNow('\${esc(c.id)}')">Publish now</button>
    \${status!=='available'?\`<button class="btn-danger" onclick="unpublish('\${esc(c.id)}')">Remove</button>\`:''}
  </div>
</li>\`;
}

// ── Date panel ────────────────────────────────────────────────────────────────
function updateDatePanel(){
  if(!selectedDate){
    document.getElementById('dp-title').textContent='Scheduled';
    document.getElementById('dp-hint').textContent='Select a date in the calendar';
    document.getElementById('dp-list').innerHTML='<div class="dp-empty">&#8592; Click a date to see what&#8217;s scheduled</div>';
    return;
  }
  const [y,m,d]=selectedDate.split('-').map(Number);
  const label=new Date(y,m-1,d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  document.getElementById('dp-title').textContent=(selectedDate===todayISO()?'Today · ':'')+label;
  document.getElementById('dp-hint').textContent='Scheduled trends';
  const dayCards=allCards.filter(c=>{
    const p=pubMap[c.id];
    return p&&p.status==='scheduled'&&tsToISO(p.scheduled_for)===selectedDate;
  });
  document.getElementById('dp-list').innerHTML=dayCards.length
    ? dayCards.map(c=>{
        const img=c.imageUrl
          ?\`<img class="dp-thumb" src="\${esc(c.imageUrl)}" alt="" loading="lazy">\`
          :'<div class="dp-thumb-empty"></div>';
        return \`<div class="dp-row">\${img}<div style="min-width:0;flex:1"><div class="dp-title">\${esc(c.title)}</div><div class="dp-sub">\${esc(c.subtitle||'')}</div></div><button class="dp-del" onclick="unpublishSilent('\${esc(c.id)}')" title="Remove from schedule">🗑</button></div>\`;
      }).join('')
    : '<div class="dp-empty">No trends scheduled for this day</div>';
}

// ── Actions ───────────────────────────────────────────────────────────────────
function toggleEdit(id){document.getElementById('edit-'+id).classList.toggle('open');}

async function toggleCheck(cardId){
  if(!selectedDate) return;
  const card=allCards.find(c=>c.id===cardId);
  if(!card) return;
  const status=getStatus(card);
  const p=pubMap[cardId];
  const schedISO=(status==='scheduled'&&p?.scheduled_for)?tsToISO(p.scheduled_for):null;
  if(status==='scheduled'&&schedISO===selectedDate) await unpublishSilent(cardId);
  else await scheduleForDate(cardId,selectedDate);
}

async function scheduleForDate(cardId,isoDate){
  const card=allCards.find(c=>c.id===cardId);
  if(!card) return;
  try{
    const res=await fetch('/api/publisher/publish?key='+encodeURIComponent(KEY),{
      method:'POST',headers:apiHeaders(),
      body:JSON.stringify({card_id:cardId,title:card.title,subtitle:card.subtitle||'',
        category:card.category||'',image_url:card.imageUrl||'',scheduled_for:isoToTS(isoDate)}),
    });
    const text=await res.text();
    if(!res.ok){alert('Schedule error: '+text);return;}
    pubMap[cardId]=JSON.parse(text).card;
    renderCalendar();renderList();updateDatePanel();
  }catch(e){alert('Network error: '+e.message);}
}

async function saveEdit(cardId){
  const el=document.getElementById('dt-'+cardId);
  if(!el||!el.value){alert('Pick a date first');return;}
  await scheduleForDate(cardId,el.value);
  document.getElementById('edit-'+cardId).classList.remove('open');
}

async function publishNow(cardId){
  const card=allCards.find(c=>c.id===cardId);
  if(!card) return;
  try{
    const res=await fetch('/api/publisher/publish?key='+encodeURIComponent(KEY),{
      method:'POST',headers:apiHeaders(),
      body:JSON.stringify({card_id:cardId,title:card.title,subtitle:card.subtitle||'',
        category:card.category||'',image_url:card.imageUrl||''}),
    });
    const text=await res.text();
    if(!res.ok){alert('Publish error: '+text);return;}
    pubMap[cardId]=JSON.parse(text).card;
    document.getElementById('edit-'+cardId).classList.remove('open');
    renderCalendar();renderList();updateDatePanel();
  }catch(e){alert('Network error: '+e.message);}
}

async function unpublishSilent(cardId){
  try{
    const res=await fetch('/api/publisher/unpublish?key='+encodeURIComponent(KEY),{
      method:'DELETE',headers:apiHeaders(),body:JSON.stringify({card_id:cardId}),
    });
    if(!res.ok){alert('Remove error: '+(await res.text()));return;}
    delete pubMap[cardId];
    renderCalendar();renderList();updateDatePanel();
  }catch(e){alert('Network error: '+e.message);}
}

async function unpublish(cardId){
  if(!confirm('Remove this trend?')) return;
  await unpublishSilent(cardId);
  document.getElementById('edit-'+cardId).classList.remove('open');
}

load();
</script>
</body></html>`;

// ── HTTP server ────────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  try {
  const urlObj = new URL(req.url, 'http://localhost');
  const urlPath = urlObj.pathname;

  // Run scheduler on each request (lightweight — just a DB read)
  runScheduler();

  // ── Analytics: POST /api/track ───────────────────────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/track') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(204); res.end();
      try {
        const d = JSON.parse(body);
        eventsAppend({
          ts:            Math.floor(Date.now() / 1000),
          session_id:    d.sessionId    ?? null,
          device_id:     d.deviceId     ?? null,
          event_name:    d.eventName    ?? 'unknown',
          card_id:       d.cardId       ?? null,
          card_title:    d.cardTitle    ?? null,
          card_category: d.cardCategory ?? null,
          collection_id: d.collectionId ?? null,
          query:         d.query        ?? null,
          platform:      d.platform     ?? null,
        });
      } catch {}
    });
    return;
  }

  // ── Analytics: GET /api/stats ────────────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/stats') {
    const period = urlObj.searchParams.get('period') || 'today';
    try {
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'});
      res.end(JSON.stringify(computeStats(period)));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:String(e)})); }
    return;
  }

  // ── Analytics dashboard: GET /stats ─────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/stats') {
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(DASHBOARD_HTML); return;
  }

  // ── Publisher dashboard: GET /publisher ──────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/publisher') {
    if (!checkPublisherKey(req)) {
      res.writeHead(403,{'Content-Type':'text/html'});
      res.end('<h2 style="font-family:sans-serif;padding:40px">🔒 Access denied — add ?key=YOUR_KEY to the URL</h2>');
      return;
    }
    res.writeHead(200,{'Content-Type':'text/html'}); res.end(PUBLISHER_HTML); return;
  }

  // ── Publisher API: GET /api/publisher/settings ──────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/publisher/settings') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(getSettings()));
    return;
  }

  // ── Publisher API: POST /api/publisher/settings ──────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/publisher/settings') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const days = parseInt(d.archive_days, 10);
        if (!days || days < 1 || days > 3650) { res.writeHead(400); res.end('Invalid archive_days (1–3650)'); return; }
        saveSettings({ archive_days: days });
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ ok: true, settings: getSettings() }));
      } catch(e) { res.writeHead(400); res.end(String(e)); }
    });
    return;
  }

  // ── Publisher API: GET /api/publisher/list ───────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/publisher/list') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    const cards = pubAll().sort((a,b)=>(b.published_at||b.scheduled_for||0)-(a.published_at||a.scheduled_for||0));
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({cards}));
    return;
  }

  // ── Publisher API: GET /api/publisher/wix-all ────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/publisher/wix-all') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    (async () => {
      try {
        const posts = await fetchAllWixCards();
        // Map to lightweight card objects for the publisher UI
        const cards = posts.map(post => {
          const rawTitle = (post.title || '').trim();
          const contentText = post.contentText || '';
          const subtitle = contentText.split('  ')[0]?.trim() || '';
          const isPlaceholder = /^trend\s*card(\s*\(page)?\s*\d+\)?$/i.test(rawTitle);
          const title = isPlaceholder && subtitle ? subtitle : rawTitle;

          // Resolve category name via categoryIds → catMap (fetched alongside posts)
          const catMap = post._catMap || {};
          const catIds = post.categoryIds || [];
          const cleanCat = catIds.map(id => catMap[id] || '').find(n => n && !/trends2030/i.test(n))?.replace(/^trends?[:\s]+/i,'').trim() || '';

          return {
            id: post.id,
            title,
            subtitle: isPlaceholder ? '' : subtitle,
            category: cleanCat,
            imageUrl: post.media?.wixMedia?.image?.url || '',
          };
        });
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'});
        res.end(JSON.stringify({cards, total: cards.length}));
      } catch(e) {
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error: String(e)}));
      }
    })();
    return;
  }

  // ── Publisher API: POST /api/publisher/publish ───────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/publisher/publish') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const now = Math.floor(Date.now() / 1000);
        const scheduledFor = d.scheduled_for ? Number(d.scheduled_for) : null;
        const isNow = !scheduledFor || scheduledFor <= now;
        const card = pubUpsert({
          card_id: d.card_id, title: d.title||'', subtitle: d.subtitle||'',
          category: d.category||'', image_url: d.image_url||'',
          scheduled_for: scheduledFor,
          published_at: isNow ? now : null,
          status: isNow ? 'published' : 'scheduled',
        });
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true,card}));
      } catch(e) {
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:String(e)}));
      }
    });
    return;
  }

  // ── Publisher API: DELETE /api/publisher/unpublish ───────────────────────────
  if (req.method === 'DELETE' && urlPath === '/api/publisher/unpublish') {
    if (!checkPublisherKey(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        pubDelete(d.card_id);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:String(e)}));
      }
    });
    return;
  }

  // ── Wix API proxy: POST /posts ───────────────────────────────────────────────
  // Splits published cards into "active" and "archived" based on archive_days setting.
  // When the client sends categoryIds containing '__archive__', returns only archived cards.
  // Otherwise returns only active (non-archived) published cards.
  // Falls through unfiltered when no cards are published yet (dev/preview mode).
  if (req.method === 'POST' && urlPath === '/posts') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const allPublished = pubAll().filter(c => c.status === 'published');
        if (allPublished.length > 0) {
          const settings = getSettings();
          const archiveCutoffSecs = Math.floor(Date.now() / 1000) - (settings.archive_days || 90) * 86400;

          // Split into active (not yet archived) vs archived (old enough)
          const activeIds   = allPublished.filter(c => !c.published_at || c.published_at > archiveCutoffSecs).map(c => c.card_id);
          const archivedIds = allPublished.filter(c =>  c.published_at && c.published_at <= archiveCutoffSecs).map(c => c.card_id);

          const parsed = JSON.parse(body);
          parsed.query = parsed.query || {};
          parsed.query.filter = parsed.query.filter || {};

          // Detect the archive sentinel in the requested categoryIds
          const reqCatIds = parsed.query.filter?.categoryIds?.$hasSome || [];
          const wantsArchive = reqCatIds.includes('__archive__');
          // Strip sentinel — keep any real Wix category IDs the client requested
          const otherCatIds = reqCatIds.filter(id => id !== '__archive__');

          // Category scope: use the remaining real IDs, or fall back to TRENDS2030 parent
          parsed.query.filter.categoryIds = { $hasSome: otherCatIds.length > 0 ? otherCatIds : [CATEGORY_ID] };

          // Apply the correct ID set; use an impossible sentinel if the list is empty
          // so Wix returns zero results rather than everything
          const idsToUse = wantsArchive ? archivedIds : activeIds;
          parsed.query.filter.id = { $hasSome: idsToUse.length > 0 ? idsToUse : ['__no_results__'] };

          body = JSON.stringify(parsed);
        }
      } catch(e) {
        console.warn('Publisher filter error:', e.message);
      }

      const pr = https.request(
        { hostname:'www.wixapis.com', path:'/blog/v3/posts/query', method:'POST',
          headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Authorization:API_KEY,'wix-site-id':SITE_ID} },
        (r) => { res.writeHead(r.statusCode,{'Content-Type':'application/json'}); r.pipe(res); }
      );
      pr.on('error',(e)=>{ res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
      pr.write(body); pr.end();
    });
    return;
  }

  // ── Wix API proxy: POST /categories ─────────────────────────────────────────
  if (req.method === 'POST' && urlPath === '/categories') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const pr = https.request(
        { hostname:'www.wixapis.com', path:'/blog/v3/categories/query', method:'POST',
          headers:{'Content-Type':'application/json',Authorization:API_KEY,'wix-site-id':SITE_ID} },
        (r) => { res.writeHead(r.statusCode,{'Content-Type':'application/json'}); r.pipe(res); }
      );
      pr.on('error',(e)=>{ res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
      pr.write(body); pr.end();
    });
    return;
  }

  // ── Dutch translations ────────────────────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/translations/nl') {
    const fp = path.join(__dirname, 'translations', 'nl.json');
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=3600'});
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ── Logo asset ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && urlPath === '/assets/futures-academy-logo.png') {
    const fp = path.join(__dirname, 'assets', 'futures-academy-logo.png');
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'public,max-age=86400'});
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────────
  let p = urlPath;
  if (p === '/') p = '/index.html';
  let fp = path.join(DIST, p);
  if (!fs.existsSync(fp)) fp = path.join(DIST, 'index.html');
  try {
    res.writeHead(200,{'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream'});
    fs.createReadStream(fp).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }

  } catch(e) {
    console.error('Unhandled request error:', e);
    if (!res.headersSent) { res.writeHead(500); res.end('Internal error'); }
  }

}).listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const ip = Object.values(os.networkInterfaces()).flat()
    .find((i) => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`\nApp:        http://${ip}:${PORT}`);
  console.log(`Analytics:  http://${ip}:${PORT}/stats`);
  console.log(`Publisher:  http://${ip}:${PORT}/publisher${PUBLISHER_KEY ? '?key=YOUR_KEY' : ''}\n`);
});
