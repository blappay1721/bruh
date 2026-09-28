// How persona messages look: accent color per persona, real avatars, compact embeds.
import { EmbedBuilder } from 'discord.js';
import { askedFooter } from './ai.js';

const PALETTE = [0x5865f2, 0xeb459e, 0x57f287, 0xfee75c, 0xed4245, 0x1abc9c, 0xe67e22, 0x9b59b6, 0x3498db, 0xf47b67];
const NEUTRAL = 0x2b2d31;

// stable color per persona, so everyone learns who's who at a glance
export const personaColor = id => PALETTE[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

// /chat reply: persona as the header, the reply as the body, who asked what in the footer
export function replyEmbed({ persona, avatar, reply, invoker, invokerAvatar, prompt }) {
  return new EmbedBuilder()
    .setColor(personaColor(persona.id))
    .setAuthor({ name: persona.name, ...(avatar && { iconURL: avatar }) })
    .setDescription(reply)
    .setFooter({ text: askedFooter(invoker, prompt), ...(invokerAvatar && { iconURL: invokerAvatar }) });
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

export const noticeEmbed = (text, color = NEUTRAL) => new EmbedBuilder().setColor(color).setDescription(text);
