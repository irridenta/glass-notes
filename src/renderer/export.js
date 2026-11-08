/* Turns a page into a single self-contained HTML document for sharing.
   Fonts are injected by the main process at the FONTS placeholder. */
(function () {
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'A', 'MARK', 'BR']);

  function clean(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const walk = (node) => {
      let out = '';
      node.childNodes.forEach((c) => {
        if (c.nodeType === 3) { out += esc(c.textContent); return; }
        if (c.nodeType !== 1) return;
        const inner = walk(c);
        if (!ALLOWED.has(c.tagName)) { out += inner; return; }
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') { out += '<br>'; return; }
        if (tag === 'a') {
          const href = c.getAttribute('href') || '';
          if (/^(https?:|mailto:)/i.test(href)) out += `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
          else out += inner;
          return;
        }
        if (tag === 'mark') {
          const cls = (c.className.match(/hl-[a-z]+/) || ['hl-violet'])[0];
          out += `<mark class="${cls}">${inner}</mark>`;
          return;
        }
        out += `<${tag}>${inner}</${tag}>`;
      });
      return out;
    };
    return walk(doc.body.firstChild);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const CHECK = '<svg viewBox="0 0 20 20" width="12" height="12"><path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function blocksHtml(blocks) {
    let out = '';
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === 'bullet' || b.type === 'number') {
        // Group consecutive list items into one list, nesting by indent.
        const tag = b.type === 'bullet' ? 'ul' : 'ol';
        const items = [];
        while (i < blocks.length && blocks[i].type === b.type) items.push(blocks[i++]);
        out += listHtml(items, tag);
        continue;
      }
      out += blockHtml(b);
      i++;
    }
    return out;
  }

  function listHtml(items, tag) {
    let out = `<${tag}>`;
    let depth = 0;
    items.forEach((it, idx) => {
      const d = Math.min(it.indent || 0, 3);
      if (idx > 0) {
        if (d > depth) { for (let k = depth; k < d; k++) out += `<${tag}>`; }
        else { out += '</li>'; for (let k = d; k < depth; k++) out += `</${tag}></li>`; }
      }
      depth = d;
      out += `<li>${clean(it.html) || '&nbsp;'}`;
    });
    out += '</li>';
    for (let k = 0; k < depth; k++) out += `</${tag}></li>`;
    return out + `</${tag}>`;
  }

  function blockHtml(b) {
    const h = clean(b.html);
    const ind = b.indent ? ` style="margin-left:${b.indent * 26}px"` : '';
    switch (b.type) {
      case 'h1': return `<h1>${h}</h1>`;
      case 'h2': return `<h2>${h}</h2>`;
      case 'h3': return `<h3>${h}</h3>`;
      case 'quote': return `<blockquote>${h}</blockquote>`;
      case 'divider': return '<hr>';
      case 'todo': return `<div class="todo${b.checked ? ' done' : ''}"${ind}><span class="box">${b.checked ? CHECK : ''}</span><span>${h || '&nbsp;'}</span></div>`;
      case 'callout': return `<div class="callout"><span class="ci">${esc(b.emoji || '💡')}</span><div>${h}</div></div>`;
      case 'code': return `<pre><code>${esc(htmlToText(b.html))}</code></pre>`;
      case 'image': return b.src && /^data:image\//.test(b.src)
        ? `<figure><img src="${esc(b.src)}" alt="">${h ? `<figcaption>${h}</figcaption>` : ''}</figure>` : '';
      default: return h ? `<p>${h}</p>` : '<p class="empty">&nbsp;</p>';
    }
  }

  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n');
    return d.textContent;
  }

  function css(theme, coverCss) {
    const dark = theme === 'dark';
    return `
${'/*@FONTS@*/'}
*{box-sizing:border-box}
:root{
  --bg:${dark ? '#07070d' : '#ffffff'};--text:${dark ? '#ecebf7' : '#1d1b2e'};--text2:${dark ? '#aeabc6' : '#55526b'};
  --text3:${dark ? '#73708c' : '#8a879f'};--line:${dark ? 'rgba(255,255,255,.09)' : 'rgba(20,16,50,.1)'};
  --panel:${dark ? 'rgba(255,255,255,.05)' : '#f6f4fd'};--accent:${dark ? '#a78bfa' : '#6d4fe0'};
  --code:${dark ? 'rgba(5,5,12,.6)' : '#1a1830'};--grad:linear-gradient(120deg,#b69cff,#7aa2ff 50%,#5eead4);
}
@page{size:A4;margin:${dark ? '0' : '16mm 0'}}${dark ? '' : '@page:first{margin-top:0}'}
html{background:var(--bg)}
body{margin:0;color:var(--text);font:16px/1.65 Inter,system-ui,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
  ${dark ? 'background:radial-gradient(60vw 60vw at -10% -20%,rgba(91,63,214,.45),transparent 60%),radial-gradient(50vw 50vw at 110% 20%,rgba(15,143,134,.32),transparent 60%),radial-gradient(45vw 45vw at 50% 120%,rgba(163,58,134,.28),transparent 60%),var(--bg);background-attachment:fixed;min-height:100vh;' : ''}
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{height:${dark ? 240 : 180}px;${dark ? 'margin:14px;border-radius:20px;' : ''}background:${coverCss || 'none'};box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
main{max-width:760px;margin:0 auto;padding:${dark ? '0 40px 120px' : '0 64px 64px'}}
.nocover main{padding-top:${dark ? 90 : 56}px}
.icon{font-size:62px;line-height:1;margin:${coverCss ? '-40px' : '0'} 0 14px;position:relative;filter:drop-shadow(0 8px 16px rgba(0,0,0,.35))}
.title{font:400 52px/1.08 "Instrument Serif",Georgia,serif;margin:${coverCss ? '0' : '0'} 0 8px;letter-spacing:-.01em}
.meta{font-size:12.5px;color:var(--text3);margin-bottom:34px;display:flex;gap:8px;align-items:center}
.meta i{width:14px;height:14px;border-radius:4px;background:var(--grad);display:inline-block}
p{margin:4px 0}p.empty{margin:0}
h1{font:400 36px/1.15 "Instrument Serif",Georgia,serif;margin:30px 0 6px}
h2{font-size:23px;line-height:1.3;font-weight:650;letter-spacing:-.015em;margin:24px 0 6px}
h3{font-size:18px;line-height:1.35;font-weight:600;margin:16px 0 4px}
ul,ol{margin:4px 0;padding-left:26px}li{margin:2px 0;padding-left:4px}
ul>li::marker{color:var(--accent)}ol>li::marker{color:var(--accent);font-variant-numeric:tabular-nums}
blockquote{margin:14px 0;padding:2px 0 2px 20px;border-left:3px solid var(--accent);font:italic 400 1.3em/1.45 "Instrument Serif",Georgia,serif;color:var(--text2)}
hr{border:0;height:1px;background:var(--line);margin:22px 0}
a{color:${dark ? '#8fb1ff' : '#3b5bdb'};text-underline-offset:3px}
code{font:.86em "JetBrains Mono",ui-monospace,Consolas,monospace;padding:2px 5px;border-radius:5px;background:${dark ? 'rgba(255,255,255,.08)' : '#efeafc'};color:${dark ? '#ffb4d5' : '#b0306f'}}
pre{background:var(--code);color:#d7e3ff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow-x:auto;margin:12px 0;white-space:pre-wrap;break-inside:avoid}
pre code{background:none;border:0;padding:0;color:inherit;font-size:13.5px;line-height:1.65}
mark{color:inherit;border-radius:4px;padding:0 2px}
.hl-violet{background:rgba(167,139,250,${dark ? .3 : .28})}.hl-blue{background:rgba(122,162,255,${dark ? .28 : .3})}
.hl-teal{background:rgba(94,234,212,${dark ? .24 : .35})}.hl-amber{background:rgba(251,191,119,${dark ? .3 : .4})}.hl-pink{background:rgba(244,154,201,${dark ? .3 : .35})}
.todo{display:flex;gap:10px;align-items:flex-start;margin:3px 0}
.todo .box{flex:none;width:18px;height:18px;margin-top:4px;border-radius:6px;border:1.5px solid ${dark ? 'rgba(255,255,255,.2)' : 'rgba(20,16,50,.25)'};display:grid;place-items:center;color:#0c0b18}
.todo.done .box{background:var(--grad);border-color:transparent}
.todo.done>span:last-child{color:var(--text3);text-decoration:line-through}
.callout{display:flex;gap:12px;padding:14px 16px;border-radius:12px;background:var(--panel);border:1px solid var(--line);margin:12px 0;break-inside:avoid}
.callout .ci{font-size:20px;line-height:1.5}
figure{margin:16px 0;text-align:center;break-inside:avoid}
figure img{max-width:100%;border-radius:12px}
figcaption{font-size:13px;color:var(--text3);margin-top:6px}
footer{margin-top:64px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--text3)}
@media (max-width:640px){main{padding:0 20px 80px}.title{font-size:40px}.cover{height:160px;margin:8px}}
@media print{body{background:var(--bg)!important}}
`;
  }

  function exportDoc(page, { theme = 'dark' } = {}) {
    const coverCss = page.cover && GN.COVERS[page.cover] ? GN.COVERS[page.cover].css : '';
    const title = page.title || 'Untitled';
    const date = new Date(page.updatedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Glass Notes">
<title>${esc(title)}</title>
<style>${css(theme, coverCss)}</style>
</head>
<body class="${coverCss ? 'hascover' : 'nocover'}">
${coverCss ? '<div class="cover"></div>' : ''}
<main>
${page.icon ? `<div class="icon">${esc(page.icon)}</div>` : ''}
<h1 class="title">${esc(title)}</h1>
<div class="meta"><i></i><span>Shared from Glass Notes · ${esc(date)}</span></div>
${blocksHtml(page.blocks || [])}
${theme === 'dark' ? '<footer>Made with Glass Notes</footer>' : ''}
</main>
</body></html>`;
  }

  window.GNExport = { exportDoc, clean, htmlToText };
})();
