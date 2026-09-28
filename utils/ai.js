// /chat client for the persona model.
// The prompt is built by bruh-data/Scripts/Phase_7/persona_server.py, exactly like the model's training data
// (style card + retrieved style lines/facts + recent chat), so this file only gathers the chat and formats the reply.
import { DiscordRequest } from '../utils.js';

const API = process.env.PERSONA_API_URL || 'http://127.0.0.1:8787';
const HISTORY = 30; // channel messages sent as context; the server trims to the training window (8 turns, 45-min session)
const PROMPT_QUOTE = 200; // chars of the prompt echoed above the reply
// our own reply format (see formatReply) — parsed back out of history so follow-up /chats keep the conversation
const REPLY_RE = /^> \*\*(.+?)\*\*: (.*)\n\*\*(.+?)\*\*: ([\s\S]*)$/;

let personas = null;
let personasAt = 0;

export async function getPersonas() {
  if (!personas || Date.now() - personasAt > 10 * 60_000) {
    const res = await fetch(`${API}/personas`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`persona server ${res.status}`);
    personas = await res.json();
    personasAt = Date.now();
  }
  return personas;
}

export function formatReply(invoker, prompt, name, reply) {
  const quote = prompt.replace(/\s+/g, ' ').slice(0, PROMPT_QUOTE);
  return `> **${invoker}**: ${quote}\n**${name}**: ${reply}`;
}

// <@id> -> @username, custom emoji -> :name: (the training export's format)
function plainMentions(m) {
  let t = m.content || '';
  for (const u of m.mentions || []) t = t.replace(new RegExp(`<@!?${u.id}>`, 'g'), `@${u.username}`);
  return t.replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<#\d+>/g, '#channel').replace(/<@&\d+>/g, '@role');
}

// Discord API message -> text the way the training export wrote it (@username, :emoji:, [sticker], attachment URL)
function messageText(m) {
  const extras = [...(m.sticker_items?.length ? ['[sticker]'] : []), ...(m.attachments || []).map(a => a.url)];
  return [plainMentions(m).trim(), ...extras].filter(Boolean).join('\n');
}

// "@name" in a reply -> a real ping for any server member whose username / display name / nickname is exactly that.
// Names in the chat logs are often display names with spaces ("@The Living Meme"), so try 3, 2, then 1 words.
// Member search is a prefix match, so one search on the first word covers every candidate length.
const memberCache = new Map(); // `${guildId}|${firstWord}` -> { names: Map(lowercase name -> id), at }
async function membersStartingWith(guildId, word) {
  const key = `${guildId}|${word.toLowerCase()}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.names;
  const names = new Map();
  try {
    const res = await DiscordRequest(`guilds/${guildId}/members/search?query=${encodeURIComponent(word)}&limit=25`, { method: 'GET' });
    for (const x of await res.json()) {
      for (const n of [x.user?.username, x.user?.global_name, x.nick]) if (n) names.set(n.toLowerCase(), x.user.id);
    }
  } catch { /* no member search access: leave as text */ }
  memberCache.set(key, { names, at: Date.now() });
  return names;
}

export async function linkMentions(reply, guildId) {
  if (!guildId) return { content: reply, users: [] }; // DMs: nobody to ping
  const users = new Set();
  let out = '';
  let last = 0;
  for (const m of reply.matchAll(/@([^\s@]+(?: [^\s@]+){0,2})/g)) {
    const words = m[1].split(' ');
    const first = words[0].replace(/[.,!?:;)]+$/, '');
    if (!first || /^(everyone|here)$/i.test(first)) continue;
    const known = await membersStartingWith(guildId, first);
    for (let n = words.length; n >= 1; n--) {
      const name = words.slice(0, n).join(' ').replace(/[.,!?:;)]+$/, ''); // "@saintsf." at the end of a sentence
      const id = known.get(name.toLowerCase());
      if (id) {
        out += reply.slice(last, m.index) + `<@${id}>`;
        last = m.index + 1 + name.length;
        users.add(id);
        break;
      }
    }
  }
  return { content: out + reply.slice(last), users: [...users].slice(0, 100) };
}

function toTurns(messages, appId) {
  const turns = [];
  for (const m of messages) {
    if (m.author?.bot) {
      if (m.author.id !== appId) continue; // other bots aren't people
      const r = REPLY_RE.exec(plainMentions(m)); // our own replies contain real <@id> pings -> back to @name
      if (r) turns.push({ author: r[1], text: r[2], ts: m.timestamp }, { author: r[3], text: r[4], ts: m.timestamp });
      continue;
    }
    const text = messageText(m);
    if (text) turns.push({ author: m.author.username, text, ts: m.timestamp });
  }
  return turns;
}

async function channelHistory(channelId) {
  try {
    const res = await DiscordRequest(`channels/${channelId}/messages?limit=${HISTORY}`, { method: 'GET' });
    return (await res.json()).reverse(); // API returns newest first
  } catch {
    return []; // no read access (DMs / user-installed contexts): answer from the prompt alone
  }
}

// -> { reply, name, persona, debug }
export async function getPersonaReply(persona, prompt, { channelId, appId, invoker }) {
  const messages = toTurns(await channelHistory(channelId), appId);
  messages.push({ author: invoker, text: prompt, ts: new Date().toISOString() });
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona, messages }),
    signal: AbortSignal.timeout(170_000), // CPU box; interaction tokens last 15 min
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `persona server ${res.status}`);
  return data;
}
