#!/usr/bin/env node
// Build localized cah pages from public/game.html (English base) + i18n/<locale>.json.
// cah is a single page (served at /). English stays public/game.html at /;
// locales are written to public/<locale>/index.html (served by express.static).
// Injects hreflang + switcher + a merged {ui,runtime} dict (window.__I18N__) so
// game.js localizes runtime strings. Deterministic replacement only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(ROOT, 'i18n/en.json'), 'utf8'));
const ORIGIN = en._meta.origin;
const LOCALES = en._meta.locales;
const HREFLANG = { en: 'en', 'pt-br': 'pt-BR', es: 'es', fr: 'fr', de: 'de', vi: 'vi', th: 'th' };
const SWITCH_LABEL = { en: 'EN', es: 'ES', 'pt-br': 'PT', fr: 'FR', de: 'DE', vi: 'VI', th: 'TH' };
const url = (l) => (l === 'en' ? `${ORIGIN}/` : `${ORIGIN}/${l}/`);
const href = (l) => (l === 'en' ? '/' : `/${l}/`);

let warnings = 0;
const rep = (s, from, to, ctx) => {
  if (!s.includes(from)) { console.warn(`  ⚠ [${ctx}] not found: ${JSON.stringify(from).slice(0, 70)}`); warnings++; return s; }
  return s.split(from).join(to);
};

const SWITCHER_SLOT = '\u0000I18N_SWITCHER\u0000';
let base = readFileSync(join(ROOT, 'public/game.html'), 'utf8')
  .replace(/\s*<!-- i18n:hreflang:start -->[\s\S]*?<!-- i18n:hreflang:end -->/g, '')
  // keep the switcher wherever it already sits in game.html (default: right after <body>)
  .replace(/\s*<!-- i18n:switcher:start -->[\s\S]*?<!-- i18n:switcher:end -->/, SWITCHER_SLOT)
  .replace(/\s*<!-- i18n:switcher:start -->[\s\S]*?<!-- i18n:switcher:end -->/g, '')
  .replace(/\s*<!-- i18n:runtime:start -->[\s\S]*?<!-- i18n:runtime:end -->/g, '');
if (!base.includes(SWITCHER_SLOT)) base = base.replace(/(<body[^>]*>)/, `$1${SWITCHER_SLOT}`);

const hreflangBlock = () => {
  const links = LOCALES.map((l) => `  <link rel="alternate" hreflang="${HREFLANG[l]}" href="${url(l)}" />`);
  links.push(`  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/" />`);
  return `\n  <!-- i18n:hreflang:start -->\n${links.join('\n')}\n  <!-- i18n:hreflang:end -->`;
};
const switcher = (cur) => {
  const items = LOCALES.map((l) => {
    const a = l === cur;
    return `<a href="${href(l)}" hreflang="${HREFLANG[l]}"${a ? ' aria-current="true"' : ''} style="${a ? 'color:#fff;font-weight:700;' : 'color:#9aa;'}text-decoration:none;">${SWITCH_LABEL[l]}</a>`;
  });
  // Collapsed globe button + popup (in page flow, not fixed). Matches the hand-tuned
  // markup shipped in 35a96a6 / 27f0ceb so rebuilding doesn't revert it.
  const btn = '<button id="lang-btn" type="button" aria-label="Language" aria-haspopup="true" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;background:rgba(6,10,6,.92);border:1px solid #1a3d1a;border-radius:999px;color:#8a8;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg></button>';
  const pop = `<div id="lang-pop" role="menu" style="display:none;position:absolute;top:calc(100% + 8px);right:0;flex-direction:column;gap:8px;background:rgba(6,10,6,.95);border:1px solid #1a3d1a;border-radius:10px;padding:9px 12px;box-shadow:0 4px 16px rgba(0,0,0,.6);font-size:12px;white-space:nowrap">${items.join('\n  ')}</div>`;
  const js = "<script>(function(){var b=document.getElementById('lang-btn'),p=document.getElementById('lang-pop');if(!b||!p)return;var d=p.querySelector('a:not([aria-current])');if(d&&d.style&&d.style.color)b.style.color=d.style.color;b.addEventListener('click',function(e){e.stopPropagation();p.style.display=p.style.display==='flex'?'none':'flex';});p.addEventListener('click',function(e){e.stopPropagation();});document.addEventListener('click',function(){p.style.display='none';});})();</script>";
  return `\n<!-- i18n:switcher:start -->\n<div id="lang-switch" style="position:relative;display:flex;justify-content:flex-end;padding:6px 10px;z-index:99999;font-family:system-ui,-apple-system,sans-serif">${btn}${pop}</div>\n${js}\n<!-- i18n:switcher:end -->`;
};
const runtimeBlock = (t) => {
  const dict = Object.assign({}, t.ui, t.runtime);
  return `<!-- i18n:runtime:start -->\n<script>\nwindow.__I18N__ = ${JSON.stringify(dict)};\nwindow.t = function(k, p){ var d = window.__I18N__ || {}; var s = String(k).split('.').reduce(function(o,i){return (o==null)?undefined:o[i];}, d); if (s == null) s = k; if (p) for (var n in p) s = s.split('{'+n+'}').join(p[n]); return s; };\n</script>\n<!-- i18n:runtime:end -->\n`;
};

// ui keys that render as simple element text >VALUE<
const SIMPLE_UI = ['yourName','createRoom','joinRoom','leaderboard','colPlayer','loading','joinGame','roomCode','back','join','lobby','shareCode','copyInvite','settings','scoreGoal','timerSec','timerOff','typeYourOwn','perPlayer','cardPacks','communityPacks','startGame','waitingHost','leave','submit','voteBest','youVoted','playAgain','mainMenu','blackCardsLabel','blackCardsExample','whiteCardsLabel','whiteImageLabel','uploadHint','upload','savePackLabel','saveToCommunity','addCardsToGame','communityHint'];
const PLACEHOLDERS = ['enterName','codePlaceholder','captionPlaceholder','packNamePlaceholder'];

// Hidden SEO <section> + FAQPage JSON-LD. Anchored on the English strings from
// en.seo / en.faqLd; translated values are HTML-escaped (section) or JSON-escaped
// (JSON-LD, with "<" as < so nothing can close the <script>).
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ldStr = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c');
const MORE_LINK = '<a href="https://games.hackatoa.com">Hackatoa Games</a>';
function localizeSeo(h, t, loc) {
  const s = t.seo, e = en.seo;
  if (!s || !t.faqLd) { console.warn(`  ⚠ [${loc}] missing seo/faqLd keys — left in English`); warnings++; return h; }
  const ctx = (k) => `${loc} seo.${k}`;
  h = rep(h, `<h1>${escHtml(e.h1)}</h1>`, `<h1>${escHtml(s.h1)}</h1>`, ctx('h1'));
  for (const k of ['intro', 'howTo', 'features']) h = rep(h, `<p>${escHtml(e[k])}</p>`, `<p>${escHtml(s[k])}</p>`, ctx(k));
  for (const k of ['howToTitle', 'featuresTitle', 'faqTitle']) h = rep(h, `<h2>${escHtml(e[k])}</h2>`, `<h2>${escHtml(s[k])}</h2>`, ctx(k));
  e.faq.forEach((x, i) => {
    h = rep(h, `<dt>${escHtml(x.q)}</dt>`, `<dt>${escHtml(s.faq[i].q)}</dt>`, ctx(`faq.${i}.q`));
    h = rep(h, `<dd>${escHtml(x.a)}</dd>`, `<dd>${escHtml(s.faq[i].a)}</dd>`, ctx(`faq.${i}.a`));
  });
  h = rep(h, `<p>${escHtml(e.more).replace('{link}', MORE_LINK)}</p>`, `<p>${escHtml(s.more).replace('{link}', MORE_LINK)}</p>`, ctx('more'));
  en.faqLd.forEach((x, i) => {
    h = rep(h, `"name": ${JSON.stringify(x.q)}`, `"name": ${ldStr(t.faqLd[i].q)}`, `${loc} faqLd.${i}.q`);
    h = rep(h, `"text": ${JSON.stringify(x.a)}`, `"text": ${ldStr(t.faqLd[i].a)}`, `${loc} faqLd.${i}.a`);
  });
  return h;
}

function build(loc, t) {
  let h = base;
  if (loc !== 'en') {
    h = h.replace(/<html lang="en">/, `<html lang="${loc}">`);
    h = rep(h, `<title>${en.title}</title>`, `<title>${t.title}</title>`, 'title');
    h = rep(h, en.description, t.description, 'description');
    h = rep(h, `content="${en.ogTitle}"`, `content="${t.ogTitle}"`, 'ogTitle');
    h = rep(h, `href="${ORIGIN}/"`, `href="${url(loc)}"`, 'canonical');
    h = rep(h, `>${en.logoTitle}<`, `>${t.logoTitle}<`, 'logoTitle');
    h = rep(h, en.intro, t.intro, 'intro');
    for (const k of SIMPLE_UI) h = rep(h, `>${en.ui[k]}<`, `>${t.ui[k]}<`, `ui.${k}`);
    for (const k of PLACEHOLDERS) h = rep(h, `placeholder="${en.ui[k]}"`, `placeholder="${t.ui[k]}"`, `ph.${k}`);
    // special (nested / trailing-space) anchors
    h = rep(h, `>${en.ui.wildCards} <`, `>${t.ui.wildCards} <`, 'ui.wildCards');
    h = rep(h, `>${en.ui.yourHandSelect} <`, `>${t.ui.yourHandSelect} <`, 'ui.yourHandSelect');
    h = rep(h, `</span> ${en.ui.cards}</div>`, `</span> ${t.ui.cards}</div>`, 'ui.cards');
    h = rep(h, `>${en.ui.nextRoundIn} <`, `>${t.ui.nextRoundIn} <`, 'ui.nextRoundIn');
    // "CUSTOM CARDS" appears twice: a button with a nested count span, and a modal title
    h = rep(h, `>${en.ui.customCards} <span id="custom-count">`, `>${t.ui.customCards} <span id="custom-count">`, 'ui.customCards.btn');
    h = rep(h, `${en.ui.customCards}\n      <button class="modal-close"`, `${t.ui.customCards}\n      <button class="modal-close"`, 'ui.customCards.modal');
    // footer
    h = rep(h, `>${en.footer.builtBy} <`, `>${t.footer.builtBy} <`, 'footer.builtBy');
    h = rep(h, `>${en.footer.allGames}<`, `>${t.footer.allGames}<`, 'footer.allGames');
    h = rep(h, `>${en.footer.coffee}<`, `>${t.footer.coffee}<`, 'footer.coffee');
    h = localizeSeo(h, t, loc);
    // absolute paths for every local asset: locale pages live at /<loc>/, so a
    // relative "sfx.js" would resolve to /<loc>/sfx.js and 404.
    h = h.replace(/\b(src|href)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+\.(?:js|css|svg|png|ico|json|webmanifest))"/gi, '$1="/$2"');
  }
  // inject hreflang + switcher + runtime
  h = h.replace('</head>', `${hreflangBlock()}\n</head>`)
       .replace(SWITCHER_SLOT, () => switcher(loc))
       .replace(/<script src="\/?game\.js"><\/script>/, (m) => `${runtimeBlock(t)}${m}`);
  return h;
}

const outPath = (loc) => (loc === 'en' ? 'public/game.html' : `public/${loc}/index.html`);
// Previous committed version of a file (git HEAD), falling back to what's on disk.
const previous = (rel) => {
  try { return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null; }
};
// Existing <lastmod> per URL, so unchanged pages keep their date (no churn on rebuild).
const oldLastmod = {};
{
  const prev = previous('public/sitemap.xml') || '';
  for (const m of prev.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) oldLastmod[m[1]] = m[2];
}
const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
const lastmod = {};

for (const loc of LOCALES) {
  const t = loc === 'en' ? en : JSON.parse(readFileSync(join(ROOT, `i18n/${loc}.json`), 'utf8'));
  const out = build(loc, t);
  const rel = outPath(loc);
  // Bump lastmod only when the generated page differs from the committed one.
  lastmod[loc] = (out === previous(rel) && oldLastmod[url(loc)]) || today;
  if (loc !== 'en') mkdirSync(join(ROOT, `public/${loc}`), { recursive: true });
  writeFileSync(join(ROOT, rel), out);
  console.log(`${loc.padEnd(5)} -> ${rel}`);
}

const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${url(l)}"/>`).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`;
const urls = LOCALES.map((l) => `  <url>\n    <loc>${url(l)}</loc>\n    <lastmod>${lastmod[l]}</lastmod>\n${alts}\n  </url>`).join('\n');
writeFileSync(join(ROOT, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
console.log('sitemap -> public/sitemap.xml');
console.log(warnings ? `\nDone with ${warnings} anchor warning(s).` : '\nDone. All anchors matched.');
