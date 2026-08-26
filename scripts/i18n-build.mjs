#!/usr/bin/env node
// Build localized cah pages from public/game.html (English base) + i18n/<locale>.json.
// cah is a single page (served at /). English stays public/game.html at /;
// locales are written to public/<locale>/index.html (served by express.static).
// Injects hreflang + switcher + a merged {ui,runtime} dict (window.__I18N__) so
// game.js localizes runtime strings. Deterministic replacement only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

let base = readFileSync(join(ROOT, 'public/game.html'), 'utf8')
  .replace(/\s*<!-- i18n:hreflang:start -->[\s\S]*?<!-- i18n:hreflang:end -->/g, '')
  .replace(/\s*<!-- i18n:switcher:start -->[\s\S]*?<!-- i18n:switcher:end -->/g, '')
  .replace(/\s*<!-- i18n:runtime:start -->[\s\S]*?<!-- i18n:runtime:end -->/g, '');

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
  return `\n<!-- i18n:switcher:start -->\n<nav aria-label="Language" style="position:fixed;top:8px;right:10px;z-index:9999;font-size:12px;font-family:system-ui,-apple-system,sans-serif;background:rgba(15,15,18,.92);border:1px solid #333;border-radius:999px;padding:5px 12px;display:flex;gap:9px;box-shadow:0 2px 10px rgba(0,0,0,.5);">\n  ${items.join('\n  ')}\n</nav>\n<!-- i18n:switcher:end -->`;
};
const runtimeBlock = (t) => {
  const dict = Object.assign({}, t.ui, t.runtime);
  return `<!-- i18n:runtime:start -->\n<script>\nwindow.__I18N__ = ${JSON.stringify(dict)};\nwindow.t = function(k, p){ var d = window.__I18N__ || {}; var s = String(k).split('.').reduce(function(o,i){return (o==null)?undefined:o[i];}, d); if (s == null) s = k; if (p) for (var n in p) s = s.split('{'+n+'}').join(p[n]); return s; };\n</script>\n<!-- i18n:runtime:end -->\n`;
};

// ui keys that render as simple element text >VALUE<
const SIMPLE_UI = ['yourName','createRoom','joinRoom','leaderboard','colPlayer','loading','joinGame','roomCode','back','join','lobby','shareCode','settings','scoreGoal','timerSec','timerOff','typeYourOwn','perPlayer','cardPacks','communityPacks','startGame','waitingHost','leave','submit','voteBest','youVoted','playAgain','mainMenu','blackCardsLabel','blackCardsExample','whiteCardsLabel','whiteImageLabel','uploadHint','upload','savePackLabel','saveToCommunity','addCardsToGame','communityHint'];
const PLACEHOLDERS = ['enterName','codePlaceholder','captionPlaceholder','packNamePlaceholder'];

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
    // absolute assets for subdir
    h = h.replace(/href="style\.css"/g, 'href="/style.css"')
         .replace(/src="name\.js"/g, 'src="/name.js"')
         .replace(/src="game\.js"/g, 'src="/game.js"');
  }
  // inject hreflang + switcher + runtime
  h = h.replace('</head>', `${hreflangBlock()}\n</head>`)
       .replace(/(<body[^>]*>)/, `$1${switcher(loc)}`)
       .replace(/<script src="\/?game\.js"><\/script>/, (m) => `${runtimeBlock(t)}${m}`);
  return h;
}

for (const loc of LOCALES) {
  const t = loc === 'en' ? en : JSON.parse(readFileSync(join(ROOT, `i18n/${loc}.json`), 'utf8'));
  const out = build(loc, t);
  if (loc === 'en') writeFileSync(join(ROOT, 'public/game.html'), out);
  else { mkdirSync(join(ROOT, `public/${loc}`), { recursive: true }); writeFileSync(join(ROOT, `public/${loc}/index.html`), out); }
  console.log(`${loc.padEnd(5)} -> ${loc === 'en' ? 'public/game.html' : `public/${loc}/index.html`}`);
}

const today = new Date().toISOString().slice(0, 10);
const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${url(l)}"/>`).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`;
const urls = LOCALES.map((l) => `  <url>\n    <loc>${url(l)}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n  </url>`).join('\n');
writeFileSync(join(ROOT, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
console.log('sitemap -> public/sitemap.xml');
console.log(warnings ? `\nDone with ${warnings} anchor warning(s).` : '\nDone. All anchors matched.');
