// Persona model client. Prompts are built by bruh-data/Scripts/Phase_7/persona_server.py exactly like the model's
// training data (style card + retrieved style lines/facts + chat turns); this file gathers the chat and resolves names.
import { DiscordRequest } from '../utils.js';
import { isPersonaEmbed } from './look.js';

const API = process.env.PERSONA_API_URL || 'http://127.0.0.1:8787';

// ---------- personas ----------
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

// persona id ("u_003") or any of its usernames -> { id, name, aliases, turns } | null
export async function findPersona(value) {
  const v = (value || '').toLowerCase();
  return (await getPersonas()).find(p => p.id === value || p.aliases.some(a => a.toLowerCase() === v)) || null;
}

// ---------- model ----------
// messages: [{ author: username, text, ts: ISO }] oldest first -> { reply, name, persona, debug }
// session: chat channel id -> the server keeps that chat's system prompt identical so Ollama reuses its cache
export async function askPersona(persona, messages, session = undefined) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona, messages, session }),
    signal: AbortSignal.timeout(170_000), // CPU box with a queue; interaction tokens last 15 min
  });
  const data = await res.json();
  if (!res.ok) throw new Error(res.status === 503 ? 'busy' : data.error || `persona server ${res.status}`);
  return data;
}

// /msg: one-off prompt, no channel context
export const getPersonaReply = (persona, prompt, invoker) =>
  askPersona(persona, [{ author: invoker, text: prompt, ts: new Date().toISOString() }]);

// ---------- /ai: general assistant on Ollama Cloud ----------
const CLOUD_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b';
const CLOUD_SYSTEM = 'You are a helpful assistant in a Discord server. Answer accurately and to the point. '
  + 'Use Discord markdown (bold, lists, code blocks); no tables, no LaTeX. Keep answers under ~1500 words.';
export const cloudModel = CLOUD_MODEL;

export async function askCloud(prompt, invoker) {
  if (!process.env.OLLAMA_API_KEY) throw new Error('OLLAMA_API_KEY is not set');
  const res = await fetch('https://ollama.com/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` },
    body: JSON.stringify({
      model: CLOUD_MODEL,
      stream: false,
      messages: [{ role: 'system', content: CLOUD_SYSTEM }, { role: 'user', content: `${invoker}: ${prompt}` }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 429 ? 'busy' : data.error || `ollama cloud ${res.status}`);
  const reply = data.message?.content?.trim(); // gpt-oss puts its reasoning in message.thinking, not here
  if (!reply) throw new Error('empty reply from ollama cloud');
  return reply;
}

// ---------- Discord message -> turn ----------
// the training export wrote @username, :emoji:, [sticker] and attachment URLs, so normalize to that
function messageText({ content = '', mentions = [], stickers = 0, attachments = [] }) {
  let t = content;
  for (const u of mentions) t = t.replace(new RegExp(`<@!?${u.id}>`, 'g'), `@${u.username}`);
  t = t.replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<#\d+>/g, '#channel').replace(/<@&\d+>/g, '@role');
  return [t.trim(), ...(stickers ? ['[sticker]'] : []), ...attachments.map(a => a.url)].filter(Boolean).join('\n');
}

// chat channels (discord.js Messages, oldest first): people's messages + this chat's persona lines (sent by its webhook)
export function discordTurns(messages, { webhookId, persona, botId }) {
  const self = new Set(persona.aliases.map(a => a.toLowerCase()));
  const turns = [];
  for (const m of messages) {
    let author;
    if (m.webhookId) {
      if (m.webhookId !== webhookId) continue;
      author = m.author.username; // the persona name the line was sent as (earlier personas stay themselves after /switch)
    } else if (m.author.bot) {
      // public chats: the bot's own reply cards are persona lines; intros, notices and other bots are skipped
      const e = m.embeds?.[0];
      if (m.author.id === botId && isPersonaEmbed(e)) turns.push({ author: e.author.name, text: e.description, ts: m.createdAt.toISOString() });
      continue;
    } else {
      // someone chatting with their own persona: "u_002 replying to u_002" confuses the model
      author = self.has(m.author.username.toLowerCase()) ? 'someone' : m.author.username;
    }
    const text = messageText({
      content: m.content, mentions: [...m.mentions.users.values()], stickers: m.stickers.size, attachments: [...m.attachments.values()],
    });
    if (text) turns.push({ author, text, ts: m.createdAt.toISOString() });
  }
  return turns;
}

// ---------- server members: pings + avatars ----------
// Member search is a prefix match, so one search on a first word covers every multi-word name starting with it.
const memberCache = new Map(); // `${guildId}|${word}` -> { names: Map(lowercase name -> user), at }
async function membersStartingWith(guildId, word) {
  const key = `${guildId}|${word.toLowerCase()}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.names;
  const names = new Map();
  try {
    const res = await DiscordRequest(`guilds/${guildId}/members/search?query=${encodeURIComponent(word)}&limit=25`, { method: 'GET' });
    for (const x of await res.json()) {
      for (const n of [x.user?.username, x.user?.global_name, x.nick]) if (n) names.set(n.toLowerCase(), x.user);
    }
  } catch { /* no member search access: names stay plain text, no avatars */ }
  memberCache.set(key, { names, at: Date.now() });
  return names;
}

// "@name" in a reply -> a real ping for any server member whose username / display name / nickname is exactly that.
// Names in the chat logs are often display names with spaces ("@The Living Meme"), so try 3, 2, then 1 words.
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
      const id = known.get(name.toLowerCase())?.id;
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

// the real person's Discord avatar for a persona (null if they're not in the server)
const avatarCache = new Map();
export async function personaAvatar(guildId, persona) {
  const key = `${guildId}|${persona.id}`;
  if (avatarCache.has(key)) return avatarCache.get(key);
  let url = null;
  if (guildId) {
    for (const alias of persona.aliases) {
      const u = (await membersStartingWith(guildId, alias.split(' ')[0])).get(alias.toLowerCase());
      if (u) {
        url = u.avatar
          ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
          : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
        break;
      }
    }
  }
  avatarCache.set(key, url);
  return url;
}
