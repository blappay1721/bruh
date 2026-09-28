// Persona chat channels: /create-chat, replies to every message, /switch, /close, inactivity cleanup.
import { ChannelType, PermissionFlagsBits as P, WebhookClient } from 'discord.js';
import { state, config, save, saveSoon } from './store.js';
import { askPersona, discordTurns, findPersona, linkMentions, personaAvatar } from './ai.js';
import { introEmbed, noticeEmbed, personaColor } from './look.js';

const DEBOUNCE_MS = 2000; // answer a quick burst of messages once, not each fragment
const LINE_GAP_MS = 700; // multi-line replies go out as separate messages, like a real burst
const runtime = new Map(); // channelId -> { timer, busy, pending }

export class UserError extends Error {} // message is safe to show the user

export const chatOf = channelId => state.chats[channelId];
export const openChatsOf = userId => Object.entries(state.chats).filter(([, c]) => c.owner === userId).map(([id]) => id);
export const canControl = (chat, userId, isAdmin) => isAdmin || chat.owner === userId;

const slug = s => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chat';
const channelName = (persona, ownerName) => `💬-${slug(persona.name)}-${slug(ownerName)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function createChat({ guild, ownerId, ownerName, persona, isPrivate, botId }) {
  const category = await guild.channels.fetch(config.chatCategoryId).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new UserError('The chat category is missing. An admin can set it with `/config chat-category`.');
  }
  // public: same visibility as the category. private: only the creator + the bot (admins see everything anyway)
  const permissionOverwrites = isPrivate
    ? [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: ownerId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
        { id: botId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageWebhooks] },
      ]
    : category.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName(persona, ownerName),
      type: ChannelType.GuildText,
      parent: category.id, // new channels land at the bottom of the category
      topic: `Chat with ${persona.name} · started by ${ownerName} · /switch · /close`,
      permissionOverwrites,
    });
  } catch (err) {
    console.error('Chat channel create failed:', err.message);
    throw new UserError("I couldn't create the channel. I need **Manage Channels** and **Manage Webhooks** in the chat category.");
  }
  const hook = await channel.createWebhook({ name: 'bruh persona' });
  const now = Date.now();
  state.chats[channel.id] = {
    persona: persona.id, owner: ownerId, ownerName, private: isPrivate, guildId: guild.id,
    webhookId: hook.id, webhookToken: hook.token, createdAt: now, lastActivity: now, warned: false,
  };
  save();
  const avatar = await personaAvatar(guild.id, persona);
  await channel.send({
    embeds: [introEmbed({ persona, avatar, ownerId, isPrivate, timeoutMin: config.chatTimeoutMin })],
    allowedMentions: { users: [ownerId] },
  });
  return channel;
}

// every human message in a chat channel
export function onMessage(message) {
  const chat = state.chats[message.channelId];
  if (!chat || message.author.bot || message.webhookId) return;
  chat.lastActivity = Date.now();
  chat.warned = false;
  saveSoon();
  const rt = runtime.get(message.channelId) || {};
  runtime.set(message.channelId, rt);
  if (rt.busy) {
    rt.pending = true; // answered right after the current reply
    return;
  }
  clearTimeout(rt.timer);
  rt.timer = setTimeout(() => respond(message.channel, rt), DEBOUNCE_MS);
}

async function respond(channel, rt) {
  const chat = state.chats[channel.id];
  if (!chat) return; // closed meanwhile
  rt.busy = true;
  rt.pending = false;
  channel.sendTyping().catch(() => {});
  const typing = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  try {
    const persona = await findPersona(chat.persona);
    if (!persona) throw new UserError('This persona no longer exists. Use `/switch` to pick another.');
    const recent = [...(await channel.messages.fetch({ limit: 30 })).values()].reverse();
    const turns = discordTurns(recent, { webhookId: chat.webhookId, persona });
    if (!turns.length) return;
    const { reply } = await askPersona(persona.id, turns);
    if (!state.chats[channel.id]) return; // closed while generating
    const hook = new WebhookClient({ id: chat.webhookId, token: chat.webhookToken });
    const avatarURL = (await personaAvatar(chat.guildId, persona)) || undefined;
    const lines = reply.split('\n').filter(Boolean);
    for (const [i, line] of lines.entries()) {
      const { content, users } = await linkMentions(line, chat.guildId);
      await hook.send({ content, username: persona.name, avatarURL, allowedMentions: { parse: [], users } });
      if (i < lines.length - 1) await sleep(LINE_GAP_MS);
    }
    chat.lastActivity = Date.now();
    saveSoon();
  } catch (err) {
    console.error(`Chat ${channel.id} reply failed:`, err);
    if (state.chats[channel.id]) {
      const text = err instanceof UserError ? err.message : '⚠️ The persona model is unreachable right now. Try again in a bit.';
      await channel.send({ embeds: [noticeEmbed(text)] }).catch(() => {});
    }
  } finally {
    clearInterval(typing);
    rt.busy = false;
    if (rt.pending && state.chats[channel.id]) rt.timer = setTimeout(() => respond(channel, rt), DEBOUNCE_MS);
  }
}

export async function switchPersona(channel, chat, persona, byId) {
  chat.persona = persona.id;
  chat.lastActivity = Date.now();
  save();
  // Discord allows 2 renames per 10 min per channel: never wait on it
  channel.setName(channelName(persona, chat.ownerName)).catch(err => console.error('Rename failed:', err.message));
  channel.setTopic(`Chat with ${persona.name} · started by ${chat.ownerName} · /switch · /close`).catch(() => {});
  return noticeEmbed(`🔄 <@${byId}> switched this chat to **${persona.name}**`, personaColor(persona.id));
}

export async function closeChat(channel) {
  forget(channel.id);
  await channel.delete('chat closed').catch(err => console.error('Channel delete failed:', err.message));
}

export function forget(channelId) {
  if (!state.chats[channelId]) return;
  clearTimeout(runtime.get(channelId)?.timer);
  runtime.delete(channelId);
  delete state.chats[channelId];
  save();
}

// warn 1 minute before the idle timeout, delete at the timeout; drop records of channels that no longer exist
export function startSweeper(client) {
  const sweep = async () => {
    const limit = config.chatTimeoutMin * 60_000;
    for (const [id, chat] of Object.entries(state.chats)) {
      // null = Discord says the channel is gone (10003); undefined = transient error, try again next sweep
      const channel = await client.channels.fetch(id).catch(err => (err.code === 10003 ? null : undefined));
      if (channel === undefined) continue;
      if (channel === null) {
        forget(id);
        continue;
      }
      const idle = Date.now() - chat.lastActivity;
      if (idle >= limit && !runtime.get(id)?.busy) {
        await closeChat(channel);
      } else if (!chat.warned && limit >= 2 * 60_000 && limit - idle <= 60_000) {
        chat.warned = true;
        saveSoon();
        channel.send({ embeds: [noticeEmbed('⏳ This chat closes in about a minute. Send a message to keep it open.')] }).catch(() => {});
      }
    }
  };
  sweep();
  return setInterval(sweep, 30_000);
}
