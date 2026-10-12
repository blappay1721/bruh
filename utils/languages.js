// Languages for /translate: names come from Intl (English + each language's own name), so "spanish", "español"
// and "es" all find Spanish, with no name table to maintain.

// the target-language dropdown (a select menu holds 25)
export const LANGUAGES = ['en', 'es', 'pt-BR', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'uk', 'tr', 'ar', 'hi', 'ja', 'ko',
  'zh-Hans', 'zh-Hant', 'vi', 'th', 'id', 'tl', 'sv', 'el', 'he', 'ro'];

// every language someone can type (ISO 639-1 plus a few common extras and regional variants)
const CODES = ('af am ar as az be bg bn bo bs ca ceb cs cy da de el en en-GB en-US eo es es-419 et eu fa fi fo fr '
  + 'fr-CA fy ga gd gl gu ha haw he hi hmn hr ht hu hy id ig is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk '
  + 'ml mn mr ms mt my ne nl no ny or pa pl ps pt pt-BR pt-PT ro ru rw sd si sk sl sm sn so sq sr st su sv sw ta te tg '
  + 'th tk tl tr tt ug uk ur uz vi xh yi yo yue zh zh-Hans zh-Hant zu').split(' ');

// common names Intl doesn't use (it calls tl "Filipino")
const ALIASES = { tl: ['Tagalog'], zh: ['Mandarin'], fa: ['Farsi'] };

const english = new Intl.DisplayNames(['en'], { type: 'language' });
export const languageName = code => { try { return english.of(code); } catch { return code; } };
const nativeName = code => { try { return new Intl.DisplayNames([code], { type: 'language' }).of(code); } catch { return null; } };
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim(); // "Español " -> "espanol"

const ALL = CODES
  .map(code => ({ code, name: languageName(code), native: nativeName(code) }))
  .filter(l => l.name !== l.code) // this Node's ICU doesn't know it
  .map(l => ({ ...l, keys: [...new Set([l.code, l.name, l.native, ...(ALIASES[l.code] ?? [])].filter(Boolean).map(fold))] }));

// Flags only where a language has one clear home country. Spread across many (Arabic, Swahili, Tamil, …), constructed
// (Esperanto, Latin) or politically loaded (Traditional Chinese, Tibetan, Uyghur, Kurdish): no flag.
// A region in the code wins: en-GB 🇬🇧, pt-BR 🇧🇷, fr-CA 🇨🇦.
const HOME = {
  af: 'ZA', am: 'ET', az: 'AZ', be: 'BY', bg: 'BG', bn: 'BD', bs: 'BA', ceb: 'PH', cs: 'CZ', da: 'DK', de: 'DE', el: 'GR',
  en: 'US', es: 'ES', et: 'EE', fa: 'IR', fi: 'FI', fo: 'FO', fr: 'FR', ga: 'IE', ha: 'NG', he: 'IL', hi: 'IN', hr: 'HR',
  ht: 'HT', hu: 'HU', hy: 'AM', id: 'ID', ig: 'NG', is: 'IS', it: 'IT', ja: 'JP', jv: 'ID', ka: 'GE', kk: 'KZ', km: 'KH',
  ko: 'KR', ky: 'KG', lb: 'LU', lo: 'LA', lt: 'LT', lv: 'LV', mg: 'MG', mi: 'NZ', mk: 'MK', mn: 'MN', ms: 'MY', mt: 'MT',
  my: 'MM', ne: 'NP', nl: 'NL', no: 'NO', ny: 'MW', pl: 'PL', ps: 'AF', pt: 'PT', ro: 'RO', ru: 'RU', rw: 'RW', si: 'LK',
  sk: 'SK', sl: 'SI', sm: 'WS', sn: 'ZW', so: 'SO', sq: 'AL', sr: 'RS', st: 'LS', su: 'ID', sv: 'SE', tg: 'TJ', th: 'TH',
  tk: 'TM', tl: 'PH', tr: 'TR', uk: 'UA', ur: 'PK', uz: 'UZ', vi: 'VN', xh: 'ZA', yo: 'NG', yue: 'HK', zh: 'CN',
  'zh-Hans': 'CN', zu: 'ZA',
};
const SPECIAL = { cy: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', gd: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'es-419': '🌎', 'zh-Hant': '' }; // Wales, Scotland, Latin America
const countryFlag = cc => String.fromCodePoint(...[...cc].map(c => 0x1f1a5 + c.charCodeAt(0))); // 'JP' -> 🇯🇵
export function flag(code) {
  if (!code) return '';
  if (code in SPECIAL) return SPECIAL[code];
  const region = code.match(/-([A-Z]{2})$/)?.[1];
  const home = region ?? HOME[code] ?? HOME[code.split('-')[0]];
  return home ? countryFlag(home) : '';
}
export const withFlag = code => `${flag(code)} ${languageName(code)}`.trim(); // "🇪🇸 Spanish"

// edit distance, for "Did you mean …?"
const distance = (a, b) => {
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};

// what someone typed -> { code, name } or { error, suggestion: code | undefined }
export function findLanguage(input) {
  const q = fold(input ?? '');
  if (!q) return { error: '❌ Type a language name, like **Portuguese** or **português**.' };
  const exact = ALL.find(l => l.keys.includes(q));
  if (exact) return exact;
  if (q.length >= 3) { // "portug" -> Portuguese: the shortest name starting with it, over "Portuguese (Brasil)"
    const starts = ALL.flatMap(l => l.keys.filter(k => k.startsWith(q)).map(k => [k.length, l])).sort((a, b) => a[0] - b[0]);
    if (starts.length) return starts[0][1];
  }
  let best, bestDistance = Infinity;
  for (const l of ALL) for (const k of l.keys) {
    const d = distance(q, k);
    if (d < bestDistance) [best, bestDistance] = [l, d];
  }
  const close = bestDistance <= Math.max(2, Math.floor(q.length / 3)) ? best : null;
  const shown = input.trim().slice(0, 40);
  return {
    error: `❌ I don't know a language called "${shown}".${close ? ` Did you mean **${close.name}**?` : ' Check the spelling and try again.'}`,
    suggestion: close?.code,
  };
}

// autocomplete: names starting with what's typed first, then names containing it
export function searchLanguages(input) {
  const q = fold(input ?? '');
  if (!q) return LANGUAGES.map(code => ALL.find(l => l.code === code)).filter(Boolean);
  const rank = l => (l.keys.some(k => k.startsWith(q)) ? 0 : l.keys.some(k => k.includes(q)) ? 1 : 2);
  return ALL.filter(l => rank(l) < 2).sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length); // Portuguese before Brazilian Portuguese
}
