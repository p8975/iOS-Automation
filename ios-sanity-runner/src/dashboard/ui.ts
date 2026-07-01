/**
 * The dashboard page, inlined as a string so it survives both `node src/cli.ts`
 * (native TS) and a `dist/` build without any asset-copy step or bundler. The
 * embedded script deliberately uses no template literals so this file's own
 * outer template literal stays valid.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>iOS Sanity — Live</title>
<style>
  :root{
    --bg:#0c0f14; --panel:#141921; --panel-2:#1b212c; --line:#262d3a;
    --ink:#e6edf3; --ink-2:#9aa6b2; --ink-3:#6b7682;
    --accent:#58a6ff;
    --pass:#3fb950; --fail:#f85149; --run:#e3a008; --pend:#6b7682;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
  .topbar{display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
  .brand{font-weight:700;letter-spacing:-.01em}
  .brand small{color:var(--ink-3);font-weight:500;margin-left:8px;font-family:var(--mono);font-size:12px}
  #conn{margin-left:auto;font-family:var(--mono);font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);display:flex;align-items:center;gap:7px}
  #conn::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ink-3)}
  #conn.live{color:var(--pass)} #conn.live::before{background:var(--pass);box-shadow:0 0 0 3px rgba(63,185,80,.18)}
  #conn.down{color:var(--run)} #conn.down::before{background:var(--run)}
  .toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 22px;border-bottom:1px solid var(--line);background:var(--panel-2)}
  .tb-title{font-size:11px;color:var(--ink-3);letter-spacing:.12em;font-weight:700}
  .toolbar label{font-size:12px;color:var(--ink-2);display:flex;align-items:center;gap:7px}
  .toolbar select{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:6px 9px;font:inherit;font-size:13px}
  .btn{font:inherit;font-size:13px;font-weight:600;border-radius:8px;padding:7px 14px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--ink)}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#04121f}
  .btn.primary:not(:disabled):hover{filter:brightness(1.08)}
  .btn.danger{background:transparent;border-color:rgba(248,81,73,.5);color:var(--fail)}
  .trigmsg{font-family:var(--mono);font-size:12px;color:var(--ink-2)}
  .step-shot{color:var(--accent);text-decoration:none;border-bottom:1px solid transparent}
  .step-shot:hover{border-bottom-color:var(--accent)}
  .layout{display:grid;grid-template-columns:288px 1fr;gap:0;min-height:calc(100vh - 57px)}
  .sidebar{border-right:1px solid var(--line);padding:18px 16px;background:var(--panel)}
  .sidebar h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 14px}
  #history{display:flex;flex-direction:column;gap:8px}
  .hist{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:10px 12px;color:var(--ink);cursor:pointer;font:inherit}
  .hist:hover{border-color:var(--accent)}
  .hist-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
  .hist-time{font-size:13px}
  .hist-counts{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
  .main{padding:26px 30px;min-width:0}
  .empty{color:var(--ink-3);font-family:var(--mono);font-size:13px;margin-top:40px}
  .muted{color:var(--ink-3);font-size:13px}
  .run-head{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin-bottom:18px}
  .run-title{display:flex;align-items:center;gap:12px;min-width:0}
  .run-id{font-family:var(--mono);font-size:14px;color:var(--ink-2);overflow-wrap:anywhere}
  .counts{display:flex;gap:10px;margin-left:auto}
  .chip{display:flex;flex-direction:column;align-items:center;padding:8px 16px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
  .chip-n{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
  .chip-l{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-top:5px}
  .chip-passed .chip-n{color:var(--pass)} .chip-failed .chip-n{color:var(--fail)}
  .bar{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--panel-2);border:1px solid var(--line)}
  .fill{height:100%;transition:width .35s ease} .fill.pass{background:var(--pass)} .fill.fail{background:var(--fail)}
  .bar-label{font-family:var(--mono);font-size:12px;color:var(--ink-2);margin:8px 0 22px}
  .suites{display:flex;flex-direction:column;gap:12px}
  .suite{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--pend);border-radius:11px;padding:15px 17px}
  .suite.st-running{border-left-color:var(--run)} .suite.st-passed{border-left-color:var(--pass)} .suite.st-failed{border-left-color:var(--fail)}
  .suite-head{display:flex;align-items:center;gap:12px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--pend);flex:none}
  .st-running .dot{background:var(--run);animation:pulse 1.1s ease-in-out infinite}
  .st-passed .dot{background:var(--pass)} .st-failed .dot{background:var(--fail)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  @media (prefers-reduced-motion:reduce){.st-running .dot{animation:none}}
  .suite-name{display:flex;flex-direction:column;min-width:0}
  .suite-title{font-weight:600;overflow-wrap:anywhere}
  .suite-meta{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
  .badge{margin-left:auto;font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 9px;border-radius:6px;color:var(--ink-2);background:var(--panel-2);border:1px solid var(--line)}
  .badge.st-running{color:var(--run);border-color:rgba(227,160,8,.4)}
  .badge.st-passed{color:var(--pass);border-color:rgba(63,185,80,.4)}
  .badge.st-failed{color:var(--fail);border-color:rgba(248,81,73,.4)}
  .suite-err{margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--fail);background:rgba(248,81,73,.08);border-radius:7px;padding:8px 11px;overflow-x:auto}
  .steps{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
  .steps li{display:flex;align-items:baseline;gap:10px;font-family:var(--mono);font-size:12.5px;color:var(--ink-2)}
  .step-mark{flex:none;width:14px}
  .steps li.ok .step-mark{color:var(--pass)} .steps li.bad .step-mark{color:var(--fail)}
  .steps li.bad{color:var(--ink)}
  .step-action{color:var(--ink)}
  .step-ms{color:var(--ink-3)}
  .step-err{color:var(--fail);overflow-wrap:anywhere}
  .steps li.finding{flex-direction:column;align-items:flex-start;gap:3px;background:rgba(255,255,255,.025);border-left:3px solid var(--ink-3);border-radius:6px;padding:7px 11px;margin:3px 0 3px 24px}
  .finding.sev-bug{border-left-color:var(--fail)} .finding.sev-warning{border-left-color:var(--run)} .finding.sev-info{border-left-color:var(--accent)}
  .f-sev{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.09em;color:var(--ink-2)}
  .finding.sev-bug .f-sev{color:var(--fail)} .finding.sev-warning .f-sev{color:var(--run)} .finding.sev-info .f-sev{color:var(--accent)}
  .f-area{color:var(--ink);font-size:13px;font-weight:600}
  .f-ea{color:var(--ink-2);font-size:12px;font-family:var(--mono)}
  .arts{display:flex;gap:14px;margin-top:12px}
  .art{font-family:var(--mono);font-size:12px;color:var(--accent);text-decoration:none;border-bottom:1px solid transparent}
  .art:hover{border-bottom-color:var(--accent)}
  @media (max-width:760px){.layout{grid-template-columns:1fr}.sidebar{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
  <div class="topbar">
    <span class="brand">iOS Sanity<small>live run monitor</small></span>
    <span id="conn">connecting…</span>
  </div>
  <div class="toolbar">
    <span class="tb-title">EXPLORE</span>
    <label>State <select id="state"></select></label>
    <label>Target <select id="target"></select></label>
    <button id="explore" class="btn primary" disabled>▶ Explore app</button>
    <button id="stop" class="btn danger" disabled>■ Stop</button>
    <span id="trigmsg" class="trigmsg"></span>
  </div>
  <div class="layout">
    <aside class="sidebar">
      <h2>Run history</h2>
      <div id="history"></div>
    </aside>
    <main class="main" id="main"></main>
  </div>
<script>
(function(){
  var statusEl = document.getElementById('conn');
  var main = document.getElementById('main');
  var historyEl = document.getElementById('history');
  var stateSel = document.getElementById('state');
  var targetSel = document.getElementById('target');
  var exploreBtn = document.getElementById('explore');
  var stopBtn = document.getElementById('stop');
  var trigMsg = document.getElementById('trigmsg');
  var pinned = null;
  var canTrigger = false;

  function opt(sel, v){ var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }
  function setBusy(b){ stopBtn.disabled = !b; exploreBtn.disabled = !canTrigger || b; }

  function el(tag, cls, text){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function clear(node){ while(node.firstChild){ node.removeChild(node.firstChild); } }
  function fmtTime(iso){ if(!iso) return ''; try { return new Date(iso).toLocaleString(); } catch(e){ return iso; } }

  function countChip(kind, n){
    var c = el('div', 'chip chip-' + kind);
    c.appendChild(el('span', 'chip-n', String(n)));
    c.appendChild(el('span', 'chip-l', kind));
    return c;
  }

  function renderSuite(s){
    var card = el('div', 'suite st-' + s.status);
    var head = el('div', 'suite-head');
    head.appendChild(el('span', 'dot'));
    var nm = el('div', 'suite-name');
    nm.appendChild(el('span', 'suite-title', s.suite));
    nm.appendChild(el('span', 'suite-meta', s.state + '  ·  ' + s.target));
    head.appendChild(nm);
    head.appendChild(el('span', 'badge st-' + s.status, s.status));
    card.appendChild(head);

    if(s.error){ card.appendChild(el('div', 'suite-err', s.error)); }

    if(s.steps && s.steps.length){
      var ul = el('ul', 'steps');
      s.steps.forEach(function(st){
        if(!st) return;
        var li = el('li', st.ok ? 'ok' : 'bad');
        li.appendChild(el('span', 'step-mark', st.ok ? '✓' : '✗'));
        li.appendChild(el('span', 'step-action', st.action));
        li.appendChild(el('span', 'step-ms', (st.durationMs != null ? st.durationMs : 0) + 'ms'));
        if(st.error){ li.appendChild(el('span', 'step-err', st.error)); }
        if(st.screenshotPath){
          var sl = el('a', 'step-shot', 'view');
          sl.href = '/artifacts/' + st.screenshotPath.split('/').map(encodeURIComponent).join('/');
          sl.target = '_blank';
          li.appendChild(sl);
        }
        ul.appendChild(li);
        if(st.findings && st.findings.length){
          st.findings.forEach(function(f){
            var fl = el('li', 'finding sev-' + (f.severity || 'info'));
            fl.appendChild(el('span', 'f-sev', (f.severity || 'info').toUpperCase() + ' · ' + (f.area || '')));
            fl.appendChild(el('span', 'f-ea', 'expected: ' + (f.expected || '') ));
            fl.appendChild(el('span', 'f-ea', 'actual: ' + (f.actual || '') ));
            ul.appendChild(fl);
          });
        }
      });
      card.appendChild(ul);
    }

    if(s.status === 'failed'){
      var arts = el('div', 'arts');
      var shot = el('a', 'art', 'screenshot');
      shot.href = '/artifacts/' + [s.suite, 'screenshot.png'].map(encodeURIComponent).join('/');
      shot.target = '_blank';
      var src = el('a', 'art', 'page source');
      src.href = '/artifacts/' + [s.suite, 'page-source.xml'].map(encodeURIComponent).join('/');
      src.target = '_blank';
      arts.appendChild(shot);
      arts.appendChild(src);
      card.appendChild(arts);
    }
    return card;
  }

  function renderRun(run){
    clear(main);
    if(!run){
      main.appendChild(el('p', 'empty', 'No run yet — start one with:  node src/cli.ts --all --dashboard'));
      return;
    }
    var head = el('div', 'run-head');
    var title = el('div', 'run-title');
    title.appendChild(el('span', 'run-id', run.id));
    title.appendChild(el('span', 'badge st-' + run.status, run.status));
    head.appendChild(title);
    var counts = el('div', 'counts');
    counts.appendChild(countChip('passed', run.passed));
    counts.appendChild(countChip('failed', run.failed));
    counts.appendChild(countChip('total', run.total));
    head.appendChild(counts);
    main.appendChild(head);

    var bar = el('div', 'bar');
    var fp = el('div', 'fill pass');
    fp.style.width = (run.total ? (run.passed / run.total * 100) : 0) + '%';
    var ff = el('div', 'fill fail');
    ff.style.width = (run.total ? (run.failed / run.total * 100) : 0) + '%';
    bar.appendChild(fp);
    bar.appendChild(ff);
    main.appendChild(bar);
    main.appendChild(el('div', 'bar-label', (run.passed + run.failed) + ' / ' + run.total + ' use cases complete'));

    var list = el('div', 'suites');
    (run.suites || []).forEach(function(s){ list.appendChild(renderSuite(s)); });
    main.appendChild(list);
  }

  function renderHistory(runs){
    clear(historyEl);
    if(!runs || !runs.length){ historyEl.appendChild(el('p', 'muted', 'No past runs.')); return; }
    runs.forEach(function(r){
      var item = el('button', 'hist st-' + r.status);
      item.appendChild(el('span', 'badge st-' + r.status, r.status));
      var meta = el('div', 'hist-meta');
      meta.appendChild(el('span', 'hist-time', fmtTime(r.startedAt)));
      meta.appendChild(el('span', 'hist-counts', r.passed + '✓  ' + r.failed + '✗  / ' + r.total));
      item.appendChild(meta);
      item.onclick = function(){ loadRun(r.id); };
      historyEl.appendChild(item);
    });
  }

  function loadRun(id){
    pinned = id;
    fetch('/api/runs/' + encodeURIComponent(id)).then(function(r){ return r.json(); }).then(renderRun).catch(function(){});
  }
  function refreshHistory(){
    fetch('/api/runs').then(function(r){ return r.json(); }).then(renderHistory).catch(function(){});
  }

  function loadCaps(){
    fetch('/api/capabilities').then(function(r){ return r.json(); }).then(function(c){
      canTrigger = !!(c && c.trigger);
      (c.states || []).forEach(function(s){ opt(stateSel, s); });
      (c.targets || []).forEach(function(t){ opt(targetSel, t); });
      if(c.defaultState){ stateSel.value = c.defaultState; }
      if(c.defaultTarget){ targetSel.value = c.defaultTarget; }
      if(!canTrigger){ trigMsg.textContent = 'Explore disabled — start the runner with config/accounts.yaml present.'; }
      setBusy(false);
    }).catch(function(){});
  }
  exploreBtn.onclick = function(){
    trigMsg.textContent = 'Starting exploration…';
    exploreBtn.disabled = true;
    fetch('/api/explore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explore', state: stateSel.value, target: targetSel.value }),
    }).then(function(r){ return r.json().then(function(b){ return { status: r.status, body: b }; }); })
      .then(function(res){
        if(res.body && res.body.ok){ trigMsg.textContent = 'Exploration started.'; pinned = null; setBusy(true); }
        else { trigMsg.textContent = (res.body && res.body.error) || ('Failed (' + res.status + ')'); setBusy(false); }
      }).catch(function(){ trigMsg.textContent = 'Request failed.'; setBusy(false); });
  };
  stopBtn.onclick = function(){
    trigMsg.textContent = 'Stopping…';
    fetch('/api/stop', { method: 'POST' }).then(function(r){ return r.json(); })
      .then(function(b){ trigMsg.textContent = b && b.stopped ? 'Stop requested — finishing current step…' : 'Nothing running.'; })
      .catch(function(){});
  };

  var es = new EventSource('/api/stream');
  es.onopen = function(){ statusEl.className = 'live'; statusEl.textContent = 'live'; };
  es.onerror = function(){ statusEl.className = 'down'; statusEl.textContent = 'reconnecting…'; };
  es.onmessage = function(ev){
    var data;
    try { data = JSON.parse(ev.data); } catch(e){ return; }
    if(data.type === 'run_started'){ pinned = null; trigMsg.textContent = ''; }
    if(data.run && (!pinned || data.run.id === pinned)){ renderRun(data.run); }
    // data.run from the stream is always the active run, so its status = device busy.
    if(data.run){ setBusy(data.run.status === 'running'); }
    if(data.type === 'run_finished' || data.type === 'run_started'){ refreshHistory(); }
  };

  loadCaps();
  refreshHistory();
  fetch('/api/current').then(function(r){ return r.json(); }).then(function(run){
    if(run && !pinned){ renderRun(run); } else if(!run){ renderRun(null); }
  }).catch(function(){ renderRun(null); });
})();
</script>
</body>
</html>`;
