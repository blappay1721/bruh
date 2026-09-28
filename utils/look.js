// How persona messages look: accent color per persona, real avatars, compact embeds.
import { EmbedBuilder } from 'discord.js';

const PALETTE = [0x5865f2, 0xeb459e, 0x57f287, 0xfee75c, 0xed4245, 0x1abc9c, 0xe67e22, 0x9b59b6, 0x3498db, 0xf47b67];
const NEUTRAL = 0x2b2d31;
const PROMPT_MAX = 300; // longer prompts are shown cut off with "…"

// stable color per persona, so everyone learns who's who at a glance
export const personaColor = id => PALETTE[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// the persona's reply card (also used for replies in public chat channels)
export function personaEmbed({ persona, avatar, reply }) {
  return new EmbedBuilder()
    .setColor(personaColor(persona.id))
    .setAuthor({ name: persona.name, ...(avatar && { iconURL: avatar }) })
    .setDescription(reply);
}

// /msg: the prompt card first (who asked + what), the persona's reply card under it
export function chatEmbeds({ persona, avatar, reply, invoker, invokerAvatar, prompt }) {
  const promptCard = new EmbedBuilder()
    .setColor(NEUTRAL)
    .setAuthor({ name: invoker, ...(invokerAvatar && { iconURL: invokerAvatar }) })
    .setDescription(clip(prompt.trim(), PROMPT_MAX));
  return [promptCard, personaEmbed({ persona, avatar, reply })];
}

// /ai: prompt card + answer cards. One answer card per message: an embed holds 4096 chars, a message 6000 total.
// ponytail: splits at a fixed length, so a long code block can break across cards; split on newlines if that bites
export function aiEmbeds({ reply, invoker, invokerAvatar, prompt, model }) {
  const promptCard = new EmbedBuilder()
    .setColor(NEUTRAL)
    .setAuthor({ name: invoker, ...(invokerAvatar && { iconURL: invokerAvatar }) })
    .setDescription(clip(prompt.trim(), PROMPT_MAX));
  const answers = reply.match(/[\s\S]{1,4096}/g).map(part => new EmbedBuilder().setColor(0x10a37f).setDescription(part));
  answers.at(-1).setFooter({ text: model });
  return [promptCard, ...answers];
}

// first message in a new chat channel
export function introEmbed({ persona, avatar, ownerId, isPrivate, timeoutMin }) {
  return new EmbedBuilder()
    .setColor(personaColor(persona.id))
    .setAuthor({ name: `Chatting with ${persona.name}`, ...(avatar && { iconURL: avatar }) })
    .setDescription(`<@${ownerId}> just type here and **${persona.name}** will answer.\n\n` +
      '`/switch` talk to someone else · `/close` end the chat')
    .setFooter({ text: `${isPrivate ? '🔒 Private' : '🌐 Public'} · closes after ${timeoutMin} min without messages` });
}

// /everyone vote card: status is 'open' | 'passed' | 'failed'
const VOTE_LOOK = {
  open: { color: 0x5865f2, title: 'Vote: ping @everyone' },
  passed: { color: 0x57f287, title: '✅ Vote passed: @everyone was pinged' },
  failed: { color: 0xed4245, title: '❌ Vote failed: not enough votes' },
};
export function voteEmbed({ status, invoker, invokerAvatar, message, voters, threshold, endsAt }) {
  const { color, title } = VOTE_LOOK[status];
  const list = voters.size ? clip([...voters].map(id => `<@${id}>`).join('\n'), 1024) : '*No votes yet*'; // field limit
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: invoker, ...(invokerAvatar && { iconURL: invokerAvatar }) })
    .setTitle(title)
    .setDescription(clip(message.trim(), PROMPT_MAX).replace(/^/gm, '> '))
    .addFields({ name: `Voted yes · ${voters.size}/${threshold}`, value: list, inline: true });
  if (status === 'open') embed.addFields({ name: 'Closes', value: `<t:${endsAt}:R>`, inline: true });
  else embed.setTimestamp();
  return embed;
}

export const noticeEmbed =(text, color = NEUTRAL) => new EmbedBuilder().setColor(color).setDescription(text);

// is this bot embed a persona line (vs. an intro or a notice)? used to read chat history back
export const isPersonaEmbed = e => Boolean(e?.author?.name && e.description && !e.author.name.startsWith('Chatting with'));
