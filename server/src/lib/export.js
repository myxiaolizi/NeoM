/**
 * Rendering & export: markdown -> HTML, docx (html-to-docx), printable HTML page,
 * and the server-rendered public shells used by /s/:id and /p/:id.
 */
import HTMLtoDOCX from 'html-to-docx';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function safeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^(https?:|\/|#|mailto:|tel:)/i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return '';
}

/* ------------------------------- inline pass ------------------------------ */
function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt, url, title) => {
    const u = safeUrl(url);
    if (!u) return alt;
    return `<img src="${u}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, label, url, title) => {
    const u = safeUrl(url);
    if (!u) return label;
    const ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${u}"${ext}${title ? ` title="${title}"` : ''}>${label}</a>`;
  });
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => `<a class="wikilink" href="#" data-wikilink="${target}">${target}</a>`);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[\s（(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s，。！？、）)])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s（(])_(?=\S)([^_\n]*?\S)_(?=$|[\s，。！？、）)])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
  s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]{1,40})/gu, (_m, p, tag) => `${p}<a class="tag" href="#" data-tag="${tag}">#${tag}</a>`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)] ?? ''}</code>`);
  return s.replace(/\n/g, '<br>');
}

/* -------------------------------- blocks --------------------------------- */
export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlank = (l) => !l || !l.trim();

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{3,}\\s*$`).test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(
        `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(buf.join('\n'))}</code></pre>`
      );
      continue;
    }

    if (isBlank(line)) {
      i++;
      continue;
    }

    // hr
    if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // heading
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const id = h[2]
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
      out.push(`<h${level} id="${escapeHtml(id) || `h${i}`}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) rows.push(splitRow(lines[i++]));
      const th = header
        .map((c, k) => `<th${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</th>`)
        .join('');
      const tb = rows
        .map(
          (r) =>
            `<tr>${r.map((c, k) => `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`
        )
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      continue;
    }

    // blockquote (collect, render recursively)
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // lists
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        i++;
        // continuation lines (indented, non-list)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          item += `\n${lines[i].trim()}`;
          i++;
        }
        const task = item.match(/^\[( |x|X)\]\s+(.*)$/s);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(`<li class="task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inline(task[2].trim())}</li>`);
        } else {
          items.push(`<li>${inline(item.trim())}</li>`);
        }
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // paragraph
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^\s*(#{1,6}\s|>|```|~~~|([-*+]|\d+[.)])\s+)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('\n').trim())}</p>`);
  }
  return out.join('\n');
}

function splitRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Plain text of markdown (for ASR/search/wordcount). */
export function mdToText(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------ standalone html ---------------------------- */
const DOC_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:#f6f7f9;color:#1d2129;font:16px/1.75 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.neom-wrap{max-width:860px;margin:0 auto;padding:40px 28px 120px}
.neom-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:40px 48px;box-shadow:0 8px 32px rgba(15,23,42,.06)}
.neom-meta{display:flex;gap:16px;flex-wrap:wrap;align-items:center;color:#6b7280;font-size:13px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #eef0f3}
.neom-badge{display:inline-flex;align-items:center;gap:6px;background:#eef4ff;color:#2f6fed;border-radius:999px;padding:2px 10px;font-size:12px}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.6em 0 .6em;font-weight:650}
h1{font-size:1.9rem}h2{font-size:1.5rem;border-bottom:1px solid #eef0f3;padding-bottom:.3em}h3{font-size:1.25rem}
p{margin:.8em 0}ul,ol{padding-left:1.6em;margin:.8em 0}li{margin:.25em 0}
a{color:#2f6fed;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f4f6f8;border:1px solid #e8ebef;border-radius:6px;padding:.1em .35em;font:13px/1.5 "Cascadia Code",Consolas,monospace}
pre.code{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:16px 18px;overflow:auto;font:13px/1.6 "Cascadia Code",Consolas,monospace}
pre.code code{background:none;border:0;color:inherit;padding:0}
blockquote{margin:1em 0;padding:.6em 1em;border-left:3px solid #2f6fed;background:#f5f8ff;border-radius:0 8px 8px 0;color:#374151}
hr{border:0;border-top:1px solid #e5e7eb;margin:2em 0}
img{max-width:100%;border-radius:10px}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px}
th,td{border:1px solid #e5e7eb;padding:8px 12px;text-align:left}th{background:#f8fafc;font-weight:600}
mark{background:#fff3b0;color:inherit;border-radius:3px;padding:0 .15em}
li.task{list-style:none;margin-left:-1.2em}
.tag{color:#2f6fed;background:#eef4ff;border-radius:6px;padding:0 .3em;font-size:.92em;text-decoration:none}
.wikilink{color:#7c3aed;border-bottom:1px dashed currentColor}
.neom-foot{margin-top:36px;color:#9ca3af;font-size:12px;text-align:center}
@media (max-width:640px){.neom-card{padding:22px 18px;border-radius:12px}.neom-wrap{padding:16px 12px 80px}}
@media print{body{background:#fff}.neom-card{border:0;box-shadow:none;padding:0}.neom-wrap{max-width:none;padding:0}.neom-noprint{display:none!important}}
`;

export function docShell({ title, bodyHtml, metaHtml = '', footer = 'Powered by NeoM', extraHead = '', extraBody = '' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${DOC_CSS}</style>${extraHead}
</head><body>
<div class="neom-wrap"><div class="neom-card">
${metaHtml}
<article class="neom-doc">${bodyHtml}</article>
</div>
<div class="neom-foot">${footer}</div>
</div>${extraBody}
</body></html>`;
}

/** Print-ready HTML returned when no headless PDF engine is available. */
export function printableHtml(title, md) {
  return docShell({
    title,
    bodyHtml: renderMarkdown(md),
    extraHead: '<style>@page{size:A4;margin:18mm}</style>',
    extraBody: '<script>window.addEventListener("load",()=>{if(location.hash==="#print")setTimeout(()=>window.print(),300)})</script>'
  });
}

/* --------------------------------- exports -------------------------------- */
export function exportHtml(title, md) {
  return docShell({ title, bodyHtml: renderMarkdown(md) });
}

function docxHtml(title, md) {
  const body = renderMarkdown(md)
    .replace(/<a class="tag"[^>]*>([^<]*)<\/a>/g, '$1')
    .replace(/<a class="wikilink"[^>]*>([^<]*)<\/a>/g, '$1');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

export async function exportDocx(title, md) {
  const buf = await HTMLtoDOCX(docxHtml(title, md), null, {
    title,
    creator: 'NeoM',
    font: 'Microsoft YaHei',
    fontSize: 22,
    margins: { top: 1000, right: 1000, bottom: 1000, left: 1000 }
  });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * PDF: no headless browser on the server, so the contract is a printable HTML
 * payload the frontend opens and prints (response carries {fallback:'html'}).
 */
export function exportPdf(title, md) {
  return { fallback: 'html', html: printableHtml(`${title}#print`, md), title };
}

/* ----------------------------- share/publish UI --------------------------- */
export function sharePage({ docName, bodyHtml, mode, comments = [], commentsOpen, extraMeta = '', shareId, readonly = true, requiresPassword = false }) {
  const meta = `<div class="neom-meta"><span class="neom-badge">${mode === 'edit' ? '可编辑协作' : mode === 'comment' ? '可评论' : '只读分享'}</span>
<span>${escapeHtml(docName)}</span>${extraMeta}</div>`;
  const widget = commentsOpen
    ? `<section class="neom-comments neom-noprint" id="neom-comments" data-share="${escapeHtml(shareId)}">
  <h3>评论 <span id="neom-comment-count">${comments.length}</span></h3>
  <ul id="neom-comment-list">${comments
    .map(
      (c) =>
        `<li><div class="neom-c-head"><b>${escapeHtml(c.author)}</b><time>${escapeHtml(String(c.created_at || '').slice(0, 16).replace('T', ' '))}</time></div><div class="neom-c-body">${escapeHtml(c.content)}</div></li>`
    )
    .join('')}</ul>
  <div class="neom-c-form">
    <input id="neom-c-author" maxlength="32" placeholder="昵称（可空）">
    <textarea id="neom-c-content" maxlength="1000" rows="3" placeholder="写下你的评论…"></textarea>
    <button id="neom-c-submit" type="button">发表评论</button>
    <span id="neom-c-msg"></span>
  </div>
</section>
<style>
.neom-comments{margin-top:32px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px 28px}
.neom-comments h3{margin:0 0 14px;font-size:1.05rem}
#neom-comment-list{list-style:none;margin:0;padding:0}
#neom-comment-list li{padding:12px 0;border-bottom:1px dashed #eef0f3}
.neom-c-head{display:flex;gap:10px;align-items:baseline;font-size:13px;color:#6b7280}
.neom-c-head b{color:#1d2129;font-size:13px}
.neom-c-body{margin-top:4px;font-size:14px;white-space:pre-wrap}
.neom-c-form{margin-top:16px;display:grid;gap:10px}
.neom-c-form input,.neom-c-form textarea{border:1px solid #dfe3e8;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;width:100%}
.neom-c-form button{justify-self:start;background:#2f6fed;color:#fff;border:0;border-radius:10px;padding:9px 20px;font-size:14px;cursor:pointer}
.neom-c-form button:disabled{opacity:.6;cursor:default}
#neom-c-msg{font-size:13px;color:#6b7280}
@media print{.neom-comments{display:none}}
</style>
<script>
(function(){
  var shareId=document.getElementById('neom-comments').dataset.share;
  var btn=document.getElementById('neom-c-submit'),msg=document.getElementById('neom-c-msg');
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  btn.addEventListener('click',function(){
    var content=document.getElementById('neom-c-content').value.trim();
    var author=document.getElementById('neom-c-author').value.trim()||'匿名';
    if(!content){msg.textContent='评论不能为空';return}
    btn.disabled=true;msg.textContent='提交中…';
    fetch('/api/share/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:shareId,content:content,author:author})})
      .then(function(r){return r.json()})
      .then(function(j){
        if(!j.status){msg.textContent=j.msg||'提交失败';btn.disabled=false;return}
        var li=document.createElement('li');
        li.innerHTML='<div class="neom-c-head"><b>'+esc(j.data.author)+'</b><time>刚刚</time></div><div class="neom-c-body">'+esc(j.data.content)+'</div>';
        document.getElementById('neom-comment-list').appendChild(li);
        var n=document.getElementById('neom-comment-count');n.textContent=String(Number(n.textContent)+1);
        document.getElementById('neom-c-content').value='';msg.textContent='评论已发布';btn.disabled=false;
      })
      .catch(function(){msg.textContent='网络错误，请稍后重试';btn.disabled=false});
  });
})();
</script>`
    : '';
  return docShell({
    title: docName,
    bodyHtml: requiresPassword ? bodyHtml : bodyHtml,
    metaHtml: meta,
    footer: 'Powered by NeoM · 云端 Markdown 工作台',
    extraBody: widget
  });
}

export function passwordPromptPage({ title, action, wrong = false }) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 需要密码</title>
<style>${DOC_CSS}
.gate{max-width:380px;margin:18vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;box-shadow:0 12px 40px rgba(15,23,42,.08)}
.gate h1{font-size:1.1rem;margin:0 0 6px}.gate p{color:#6b7280;font-size:13px;margin:0 0 18px}
.gate input{width:100%;border:1px solid #dfe3e8;border-radius:10px;padding:11px 13px;font:inherit;font-size:15px;margin-bottom:12px}
.gate button{width:100%;background:#2f6fed;color:#fff;border:0;border-radius:10px;padding:11px;font-size:15px;cursor:pointer}
.gate .err{color:#e5484d;font-size:13px;margin:-4px 0 10px}
</style></head><body>
<form class="gate" method="get" action="${escapeHtml(action)}">
  <h1>${escapeHtml(title)}</h1><p>该页面受密码保护，请输入访问密码。</p>
  ${wrong ? '<div class="err">密码错误，请重试</div>' : ''}
  <input type="password" name="pwd" placeholder="访问密码" autofocus required>
  <button type="submit">进入</button>
</form></body></html>`;
}

export function notFoundPage(title = '页面不存在或已失效') {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${DOC_CSS}</style></head>
<body><div class="neom-wrap"><div class="neom-card" style="text-align:center;padding:64px 24px">
<h1 style="margin-top:0">😕 ${escapeHtml(title)}</h1>
<p style="color:#6b7280">链接可能已过期、被撤销，或需要访问密码。</p>
<p><a class="neom-badge" href="https://m.zhengl.vip">返回 NeoM 首页</a></p>
</div></div></body></html>`;
}
