#!/usr/bin/env node
// Translate i18n/en.json -> i18n/<locale>.json via Gemini.
// Usage: GEMINI_API_KEY=... node scripts/i18n-translate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const en = JSON.parse(readFileSync(join(ROOT, 'i18n/en.json'), 'utf8'));
const LOCALES = en._meta.locales.filter((l) => l !== 'en');
const LANG_NAMES = {
  'es': 'Spanish', 'pt-br': 'Brazilian Portuguese', 'fr': 'French',
  'de': 'German', 'vi': 'Vietnamese', 'th': 'Thai',
};

// strip _meta before translating; keep it out of the model payload
const { _meta, ...source } = en;

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });
    const data = await res.json().catch(() => ({}));
    const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (txt) return txt;
    const status = data?.error?.status || res.status;
    console.warn(`  attempt ${attempt} failed (${status}), retrying...`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error('Gemini failed after retries');
}

const prompt = (langName, code, obj) => `You are a professional game-UI and web localizer.
Translate ALL human-readable string VALUES in this JSON from English into ${langName} (locale code "${code}").

Hard rules:
- Return ONLY the translated JSON object, same keys and structure, valid JSON.
- Do NOT translate JSON keys. Keep arrays the same length and order.
- Keep any emoji and leading symbols (e.g. "🏆", "☕", "↑", "→") exactly.
- Keep any {curly} placeholder tokens (e.g. {code}, {ship}, {cell}) EXACTLY as-is, unchanged and untranslated.
- Use the natural, commonly-searched local name of the game for "gameName", "logoTitle", "title" and "ogTitle" (e.g. German "Schiffe versenken", Spanish "Batalla Naval"). "logoTitle" should be uppercase.
- Keep it natural and idiomatic for native speakers, concise enough to fit game buttons.
- Set "htmlLang" to "${code}".

JSON to translate:
${JSON.stringify(obj, null, 2)}`;

for (const code of LOCALES) {
  process.stdout.write(`Translating -> ${code} (${LANG_NAMES[code]})... `);
  const raw = await gemini(prompt(LANG_NAMES[code], code, source));
  let out;
  try { out = JSON.parse(raw); } catch (e) { console.error('\n  bad JSON:', raw.slice(0, 200)); throw e; }
  out.htmlLang = code;
  out._meta = { ..._meta, generatedFrom: 'i18n/en.json', locale: code };
  writeFileSync(join(ROOT, `i18n/${code}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log('ok');
}
console.log('Done.');
