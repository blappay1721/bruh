import 'dotenv/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { client } from './client.js';
import { DiscordRequest } from './utils.js';
import {
  askCloud, cloudErrorMessage, cloudModel, findPersona, getPersonas, getPersonaReply, linkMentions, personaAvatar, translate,
} from './utils/ai.js';
import { aiEmbeds, chatEmbeds, noticeEmbed, splitPages, translateEmbed, voteEmbed } from './utils/look.js';
import { LANGUAGES, findLanguage, flag, languageName, searchLanguages, withFlag } from './utils/languages.js';
import { config, save, CONFIG_SPEC } from './utils/store.js';
import {
  UserError, canControl, chatOf, closeChat, createChat, forget, onMessage, openChatsOf, startSweeper, switchPersona,
} from './utils/chats.js';

// Interactions arrive over the gateway (client.js), not HTTP: no Express server, no public URL, no PUBLIC_KEY.
const allowedChannelId = process.env.ALLOWED_CHANNEL_ID;
const spammingUsers = new Map();
let activeVoteWindow = null;
const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });
const isAdmin = interaction => interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
// a failed REST call in a timer (vote countdown, pingbomb) shouldn't take the whole bot down
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.once('ready', () => startSweeper(client));
client.on('messageCreate', message => onMessage(message));
client.on('channelDelete', channel => {
  forget(channel.id); // deleted by hand: stop tracking it
  for (const [user, bomb] of spammingUsers) if (bomb.channel?.id === channel.id) stopBomb(user);
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) return await onAutocomplete(interaction);
    if ((interaction.isMessageComponent() || interaction.isModalSubmit()) && TRANSLATE_UI.test(interaction.customId)) {
      return await onTranslateUi(interaction);
    }
    if (interaction.isButton()) return await onButton(interaction);
    if (interaction.isMessageContextMenuCommand()) return await startTranslation(interaction);
    if (interaction.isChatInputCommand()) return await onCommand(interaction);
  } catch (err) {
    console.error(`Interaction failed (${interaction.commandName || interaction.customId}):`, err);
    if (interaction.isRepliable() && !interaction.replied) {
      const msg = err instanceof UserError ? `⚠️ ${err.message}` : '⚠️ Something went wrong.';
      await (interaction.deferred ? interaction.editReply(msg) : interaction.reply(ephemeral(msg))).catch(() => {});
    }
  }
});

// persona pickers (36 personas > Discord's 25 fixed choices, so autocomplete)
async function onAutocomplete(interaction) {
  if (interaction.commandName === 'translate') { // language: "🇪🇸 Spanish · español"
    return interaction.respond(searchLanguages(interaction.options.getFocused()).slice(0, 25).map(l => ({
      name: `${withFlag(l.code)}${l.native && l.native !== l.name ? ` · ${l.native}` : ''}`.slice(0, 100), value: l.code,
    })));
  }
  if (!['msg', 'chat', 'switch'].includes(interaction.commandName)) return interaction.respond([]);
  const q = interaction.options.getFocused().toLowerCase();
  let choices = [];
  try {
    choices = (await getPersonas())
      .filter(p => !q || p.aliases.some(a => a.toLowerCase().includes(q)))
      .slice(0, 25)
      .map(p => ({ name: p.name, value: p.id }));
  } catch (err) {
    console.error('Persona list failed:', err.message);
  }
  return interaction.respond(choices);
}

// Vote buttons from /everyone
async function onButton(interaction) {
  const state = activeVoteWindow;
  // Revoke lives on the voter's ephemeral message, so it carries the vote card's id instead of sitting on it
  const [action, cardId = interaction.message.id] = interaction.customId.split(':');

  if (!state || !state.votingActive || state.messageId !== cardId) {
    const msg = 'Voting has already ended or this message is not active.';
    return action === 'vote_revoke' ? interaction.update({ content: msg, components: [] }) : interaction.reply(ephemeral(msg));
  }

  // the card's buttons are shared by everyone; per-user Revoke goes in a message only the voter sees
  const voted = state.voters.has(interaction.user.id);
  const revokeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vote_revoke:${cardId}`).setLabel('Revoke vote').setStyle(ButtonStyle.Danger),
  );
  if (action === 'vote_yes') {
    if (voted) return interaction.reply({ ...ephemeral('✅ You already voted yes.'), components: [revokeRow] });
    state.voters.add(interaction.user.id);
    if (state.voters.size < state.threshold) {
      await interaction.update(state.render('open'));
      return interaction.followUp({ ...ephemeral('✅ You voted yes.'), components: [revokeRow] });
    }

    state.votingActive = false;
    clearTimeout(state.timer);
    activeVoteWindow = null;
    await interaction.update(state.render('passed'));
    // the ping itself: the invoker's message as context, replying to the vote card that approved it
    await DiscordRequest(`/channels/${state.channelId}/messages`, {
      method: 'POST',
      body: {
        content: '@everyone',
        embeds: [noticeEmbed(state.message.trim().slice(0, 4096)).setAuthor({ name: state.invoker, iconURL: state.invokerAvatar }).toJSON()],
        message_reference: { message_id: cardId, fail_if_not_exists: false },
        allowed_mentions: { parse: ['everyone'] },
      },
    });
    return;
  }

  if (action === 'vote_revoke') {
    if (!voted) return interaction.update({ content: "You haven't voted.", components: [] });
    state.voters.delete(interaction.user.id);
    await interaction.update({ content: '↩️ Vote revoked.', components: [] });
    return state.interaction.editReply(state.render('open'));
  }
}

async function onCommand(interaction) {
  const name = interaction.commandName;
  const channelId = interaction.channelId;

  // /switch and /close live inside chat channels, /config anywhere (admins); everything else in the allowed channel
  if (name === 'switch' || name === 'close') return onChatControl(interaction);
  if (name === 'config') return onConfig(interaction);
  if (name === 'stopping') return onStopping(interaction); // also works from inside the pingbomb channel
  if (name === 'translate') return startTranslation(interaction); // anywhere the app is installed
  if (channelId !== allowedChannelId) {
    return interaction.reply(ephemeral('❌ This command can only be used in the designated channel.'));
  }

  if (name === 'test') {
    return interaction.reply('m');
  }

  if (name === 'ai') {
    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();
    let reply;
    try {
      reply = await askCloud(prompt, interaction.user.username);
    } catch (err) {
      console.error('Ollama Cloud error:', err.status ?? err.name, err.message);
      return interaction.editReply(cloudErrorMessage(err));
    }
    const [promptCard, ...answers] = aiEmbeds({
      reply, invoker: interaction.user.username, invokerAvatar: interaction.user.displayAvatarURL(), prompt, model: cloudModel,
    });
    const noPings = { parse: [] }; // the model can write @everyone or <@id>; never let it ping
    await interaction.editReply({ embeds: [promptCard, answers[0]], allowedMentions: noPings });
    for (const card of answers.slice(1)) await interaction.followUp({ embeds: [card], allowedMentions: noPings });
    return;
  }

  if (name === 'msg') {
    const personaValue = interaction.options.getString('persona') || '';
    const prompt = interaction.options.getString('prompt') || '';
    const invoker = interaction.user.username;
    await interaction.deferReply();
    try {
      const persona = await findPersona(personaValue);
      if (!persona) throw new UserError('Pick a persona from the list.');
      const { reply } = await getPersonaReply(persona.id, prompt, invoker);
      const { content, users } = await linkMentions(reply, interaction.guildId);
      const avatar = await personaAvatar(interaction.guildId, persona);
      await interaction.editReply({
        // pings only work in message text (never inside embeds), so named people are listed there
        content: users.length ? users.map(id => `<@${id}>`).join(' ') : '',
        embeds: chatEmbeds({ persona, avatar, reply: content, invoker, invokerAvatar: interaction.user.displayAvatarURL(), prompt }),
        allowedMentions: { parse: [], users },
      });
    } catch (err) {
      console.error('Persona chat error:', err.message);
      await interaction.editReply(err instanceof UserError ? `⚠️ ${err.message}`
        : err.message === 'busy' ? '⏳ Lots of chats going right now. Try again in a moment.'
          : '⚠️ The persona model is unreachable right now.');
    }
    return;
  }

  if (name === 'chat') {
    const persona = await findPersona(interaction.options.getString('persona'));
    if (!persona) return interaction.reply(ephemeral('⚠️ Pick a persona from the list.'));
    const open = openChatsOf(interaction.user.id);
    if (config.chatLimit && open.length >= config.chatLimit) {
      return interaction.reply(ephemeral(`You already have ${open.map(id => `<#${id}>`).join(', ')} open. \`/close\` it first.`));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await createChat({
      guild: interaction.guild, ownerId: interaction.user.id, ownerName: interaction.user.username, persona,
      isPrivate: interaction.options.getString('visibility') === 'private', botId: client.user.id,
    });
    return interaction.editReply(`Your chat with **${persona.name}** is ready: ${channel}`);
  }

  if (name === 'pingbomb') {
    const target = interaction.options.getUser('user');
    const user = target.id;
    const initiator = interaction.user.id;

    if (spammingUsers.has(user)) {
      return interaction.reply(ephemeral(`<@${user}> is already being pingbombed by <@${spammingUsers.get(user).startedBy}>.`));
    }
    const category = await interaction.guild.channels.fetch(config.chatCategoryId).catch(() => null);
    if (category?.type !== ChannelType.GuildCategory) {
      return interaction.reply(ephemeral('The chat category is missing. An admin can set it with `/config chat-category`.'));
    }

    const bomb = { active: true, startedBy: initiator };
    spammingUsers.set(user, bomb); // claimed before any await, so two /pingbomb at once can't both start
    await interaction.deferReply();
    try {
      // its own channel, same visibility as the category, so anyone can watch and chat along
      bomb.channel = await interaction.guild.channels.create({
        name: `💣-pingbomb-${target.username}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Pingbomb on ${target.username} · started by ${interaction.user.username} · /stopping`,
        permissionOverwrites: category.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
      });
    } catch (err) {
      spammingUsers.delete(user);
      console.error('Pingbomb channel create failed:', err.message);
      return interaction.editReply("⚠️ I couldn't create the pingbomb channel. I need **Manage Channels** in the chat category.");
    }
    if (!bomb.active) return bomb.channel.delete('pingbomb stopped').catch(() => {}); // /stopping raced the create
    // kept as a message, not the interaction: its token dies after 15 min, a bot can edit its own message forever
    bomb.startMessage = await interaction.editReply(`💣 Pingbombing <@${user}> (started by <@${initiator}>) in ${bomb.channel}`);

    // the timer lives on the bomb so /stopping can cancel it; re-checked on fire in case it was already due
    const tick = i => {
      bomb.timer = setTimeout(async () => {
        if (!bomb.active) return;
        await bomb.channel.send({ content: `<@${user}> ping ${i}`, allowedMentions: { users: [user] } })
          .catch(err => console.error(`Failed to send ping #${i}:`, err.message));
        if (bomb.active) tick(i + 1);
      }, Math.random() * config.pingbombMaxDelaySec * 1000);
    };
    tick(1);
    return;
  }

  if (name === 'help') {
    const helpText = `
**bruh** is a multifunctional Discord bot built using Node.js and discord.js.

---

## 🚀 Features

### \`/ai\`
Ask a question and get a real answer (${cloudModel} on Ollama Cloud).

### \`/msg\`
Pick a persona and they reply in their own voice (fine-tuned model + past-chat memory).

### \`/chat\`
Open your own channel to chat with a persona (private or public). \`/switch\` changes who you're talking to, \`/close\` ends it. Idle chats close after ${config.chatTimeoutMin} min.

### \`/translate\`
Translate text only you can see, into your Discord language (or \`language:\`). For a message in chat: right-click it → Apps → Translate.

### \`/pingbomb\`
Spam-pings a user randomly until stopped.

### \`/stopping\`
Stop pingbombs you've started or are targeted by.

### \`/everyone\`
\`/everyone message:<why>\` starts a ${config.voteSeconds}s vote. If ${config.voteThreshold} people vote yes, everyone is pinged with your message.

### \`/config\`
Admins: bot settings.

### \`/test\`
Simple test command.
      `;
    const chunks = helpText.match(/[\s\S]{1,2000}/g) || ['No help content'];
    await interaction.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
    return;
  }

  if (name === 'everyone') {
    if (activeVoteWindow?.votingActive) {
      return interaction.reply(ephemeral('⚠️ A vote is already in progress. Please wait for it to end.'));
    }

    const voteWindow = {
      voters: new Set(),
      votingActive: true,
      threshold: config.voteThreshold, // fixed for this vote even if /config changes mid-vote
      message: interaction.options.getString('message'),
      invoker: interaction.member?.displayName ?? interaction.user.displayName,
      invokerAvatar: interaction.user.displayAvatarURL(),
      channelId,
    };
    activeVoteWindow = voteWindow; // claimed before any await, so two /everyone at once can't both start
    const duration = config.voteSeconds;
    const endsAt = Math.floor(Date.now() / 1000) + duration;

    // <t:…:R> is ticked live by each Discord client, so the card is only edited when votes change
    const voteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vote_yes').setLabel('Vote yes').setEmoji('✅').setStyle(ButtonStyle.Success),
    );
    voteWindow.interaction = interaction; // revokes edit the card through it (token lasts 15 min > max duration)
    voteWindow.render = status => ({
      embeds: [voteEmbed({ ...voteWindow, status, endsAt })],
      components: status === 'open' ? [voteRow] : [],
    });

    try {
      const res = await interaction.reply({ ...voteWindow.render('open'), withResponse: true });
      voteWindow.messageId = res.resource.message.id;
    } catch (err) {
      activeVoteWindow = null;
      throw err;
    }

    voteWindow.timer = setTimeout(() => {
      voteWindow.votingActive = false;
      activeVoteWindow = null;
      return interaction.editReply(voteWindow.render('failed')); // same card, no new message
    }, duration * 1000);
    return;
  }

  return interaction.reply(ephemeral('Unknown command.'));
}

// cancels the pending timer (not just a flag) and deletes the channel, which also removes a ping already in flight
function stopBomb(user, byId) {
  const bomb = spammingUsers.get(user);
  if (!bomb) return;
  spammingUsers.delete(user);
  bomb.active = false;
  clearTimeout(bomb.timer);
  bomb.startMessage?.edit({
    content: `🛑 Pingbomb on <@${user}> (started by <@${bomb.startedBy}>) was stopped${byId ? ` by <@${byId}>` : ''}.`,
    allowedMentions: { parse: [] }, // an edit shouldn't re-ping anyone
  }).catch(err => console.error('Pingbomb start message edit failed:', err.message));
  if (bomb.channel) setTimeout(() => bomb.channel.delete('pingbomb stopped').catch(() => {}), 5000);
}

async function onStopping(interaction) {
  const initiator = interaction.user.id;
  const admin = isAdmin(interaction);
  const targetUserOption = interaction.options.getUser('user')?.id;
  const targets = targetUserOption ? [targetUserOption] : [...spammingUsers.keys()];
  const allowed = targets.filter(t => spammingUsers.has(t) && (spammingUsers.get(t).startedBy === initiator || initiator === t || admin));
  allowed.forEach(t => stopBomb(t, initiator));

  return interaction.reply(allowed.length
    ? `Pingbomb${targetUserOption ? ` for <@${targetUserOption}>` : (admin ? 's have' : 's you started or are targeted by have')} been stopped. Channel closes in 5s.`
    : `You have no permission to stop that pingbomb.`);
}

// /translate, the "Translate" message menu, and the card's buttons. Ephemeral, and never reads the channel itself,
// so it works in servers and DMs without the bot.
// AES-256-GCM: a fresh random IV each time, the tag catches a wrong key or tampering (unseal throws)
const seal = (key, text) => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  return { iv, data: Buffer.concat([c.update(text, 'utf8'), c.final()]), tag: c.getAuthTag() };
};
const unseal = (key, { iv, data, tag }) => {
  const d = createDecipheriv('aes-256-gcm', key, iv).setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
};
// Both stores below are Maps kept in last-used order: a hit moves an entry to the back, overflow drops the front
const touch = (map, k, v) => { map.delete(k); map.set(k, v); };
const trim = (map, max) => { if (map.size > max) map.delete(map.keys().next().value); };

// Open cards: card key -> { text, scope, author, avatar, url, lang, from, source, sourceCode, alts, pages } sealed,
// so the picker can re-translate and
// ◀ ▶ can page. Each card's random key lives only in its own buttons (Discord hands it back on every click), never in
// the bot, so this memory holds nothing readable. No expiry; past OPEN_MAX the least recently used card goes
// ("expired", as after a restart).
const OPEN_MAX = 500;
const openCards = new Map();
const loadCard = (key, secret) => {
  const box = openCards.get(key);
  if (!box) return null;
  touch(openCards, key, box);
  try { return JSON.parse(unseal(Buffer.from(secret, 'base64url'), box)); } catch { return null; }
};
const saveCard = (key, secret, card) => {
  touch(openCards, key, seal(Buffer.from(secret, 'base64url'), JSON.stringify(card)));
  trim(openCards, OPEN_MAX);
};

// Translation cache: (text + language + corrected source) -> { text, source, alts }, no expiry, least recently used
// dropped past CACHE_MAX. A "Not Spanish?" correction is its own entry, so it never overwrites what others get.
// Encrypted with a key derived from the text itself: memory holds no original text, and an entry only opens for
// someone who already has that exact text. Server messages are shared by everyone; DMs and typed text also mix in
// the user's id, so nobody can tell (by an instant answer) what someone else translated.
const CACHE_MAX = 2000;
const cache = new Map(); // id -> sealed translation
const inFlight = new Map(); // id -> pending translation: two people translating the same thing share one model call
const sha = (...parts) => createHash('sha256').update(parts.join('\0')).digest();
// Fair use of the bot's Ollama key, now that anyone can install the app: model calls per person and for everyone
// together, over sliding windows. Cache hits and joining someone else's in-flight call are free.
const USER_MAX = 30, USER_MS = 10 * 60_000, ALL_MAX = 300, ALL_MS = 60 * 60_000;
const recentCalls = new Map(); // user id, or '*' for everyone -> times of recent model calls
function rateLimited(userId) {
  const now = Date.now();
  const recent = (k, ms) => {
    const list = (recentCalls.get(k) ?? []).filter(t => now - t < ms);
    recentCalls.set(k, list);
    return list;
  };
  const all = recent('*', ALL_MS), mine = recent(userId, USER_MS);
  if (all.length >= ALL_MAX) return Object.assign(new Error('rate limited'), { retryAt: all[0] + ALL_MS, everyone: true });
  if (mine.length >= USER_MAX) return Object.assign(new Error('rate limited'), { retryAt: mine[0] + USER_MS });
  all.push(now);
  mine.push(now);
  if (recentCalls.size > 5000) { // forget people with no recent calls (never the everyone counter: its window is longer)
    for (const [k, list] of recentCalls) if (k !== '*' && (!list.length || now - list.at(-1) > USER_MS)) recentCalls.delete(k);
  }
  return null;
}

async function cachedTranslate(text, language, from, scope, userId) {
  const secret = sha(scope, language, from ?? '', text).toString('hex');
  const id = sha('id', secret).toString('hex');
  const key = sha('key', secret);
  const hit = cache.get(id);
  if (hit) {
    touch(cache, id, hit); // so phrases in constant use never reach the front
    return JSON.parse(unseal(key, hit));
  }
  if (!inFlight.has(id)) {
    const limited = rateLimited(userId);
    if (limited) throw limited;
    inFlight.set(id, translate(text, language, from).then(out => { // failures aren't cached: the next try calls the model again
      cache.set(id, seal(key, JSON.stringify(out)));
      trim(cache, CACHE_MAX);
      return out;
    }).finally(() => inFlight.delete(id)));
  }
  return inFlight.get(id);
}

// Every card control carries `action:cardKey:[arg:]secret` in its custom id (max 100 chars; the secret is 43)
const TRANSLATE_UI = /^(translate|tpage|tnot|tback|tsrc|tother|tmodal):/;
const EXPIRED = { content: '⌛ This translation expired. Run it again.', components: [] };

// a new card: from the Translate message menu or /translate
async function startTranslation(interaction) {
  const m = interaction.isMessageContextMenuCommand() ? interaction.targetMessage : null;
  const card = m
    ? { text: m.content, author: m.author.displayName, avatar: m.author.displayAvatarURL(), url: m.url }
    : { text: interaction.options.getString('text'), author: interaction.user.displayName, avatar: interaction.user.displayAvatarURL() };
  if (!card.text.trim()) return interaction.reply(ephemeral('Nothing to translate: that message has no text.'));
  let lang = interaction.locale; // the user's Discord language
  const typed = !m && interaction.options.getString('language');
  if (typed) {
    const found = findLanguage(typed);
    if (!found.code) return interaction.reply(ephemeral(found.error));
    lang = found.code;
  }
  card.scope = m && interaction.guildId ? 'server' : interaction.user.id; // see the cache note above
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return finishTranslation(interaction, interaction.id, randomBytes(32).toString('base64url'), card, lang, undefined);
}

// clicks on a card: ◀ ▶, the language dropdown, "Not Spanish?" and its suggestions, Other…, Back
async function onTranslateUi(interaction) {
  const [action, key, ...rest] = interaction.customId.split(':');
  const secret = rest.pop();
  const arg = rest[0];
  const page = Number(arg) || 0;
  const card = loadCard(key, secret);
  if (!card?.pages) return interaction.update(EXPIRED);
  switch (action) {
    case 'tpage': return interaction.update(translationView(key, secret, card, page)); // no model call
    case 'tback': return interaction.update(translationView(key, secret, card, page));
    case 'tnot': return interaction.update(sourcePicker(key, secret, card, page));
    case 'tother': return interaction.showModal(languageModal(key, secret, page));
    case 'tmodal': {
      const found = findLanguage(interaction.fields.getTextInputValue('language'));
      if (!found.code) return interaction.update({ ...sourcePicker(key, secret, card, page, found.suggestion), content: found.error });
      return retranslate(interaction, key, secret, card, card.lang, found.code);
    }
    case 'tsrc': return retranslate(interaction, key, secret, card, card.lang, arg);
    case 'translate': return retranslate(interaction, key, secret, card, interaction.values[0], card.from);
  }
}

async function retranslate(interaction, key, secret, card, lang, from) {
  const what = from !== card.from ? `from ${withFlag(from)}` : `to ${withFlag(lang)}`;
  await interaction.update({ content: `⏳ Translating ${what}…`, components: [] }); // controls off until done
  return finishTranslation(interaction, key, secret, card, lang, from);
}

// from: the source language the user picked after "Not Spanish?" (sticks for later target changes)
async function finishTranslation(interaction, key, secret, card, lang, from) {
  let out;
  try {
    out = await cachedTranslate(card.text, languageName(lang), from && languageName(from), card.scope, interaction.user.id);
  } catch (err) {
    const when = `<t:${Math.ceil((err.retryAt ?? 0) / 1000)}:R>`; // Discord shows "in 4 minutes", live
    const msg = !err.retryAt ? cloudErrorMessage(err)
      : err.everyone ? `🐢 Lots of people are translating right now. Try again ${when}.`
        : `🐢 You've translated a lot in the last few minutes. Try again ${when}.`;
    if (!err.retryAt) console.error('Translate error:', err.status ?? err.name, err.message);
    // a card that already had a translation gets it back with its controls, so they can try again
    return interaction.editReply(card.pages ? { ...translationView(key, secret, card, 0), content: msg } : msg);
  }
  const sourceCode = from ?? (out.source && findLanguage(out.source).code);
  Object.assign(card, {
    lang, from, sourceCode, source: out.source, pages: splitPages(out.text), removed: out.removed,
    alts: [...new Set(out.alts.map(name => findLanguage(name).code))].filter(c => c && c !== sourceCode),
  });
  saveCard(key, secret, card);
  return interaction.editReply({ ...translationView(key, secret, card, 0), allowedMentions: { parse: [] } });
}

const emojiOf = code => (flag(code) ? { emoji: { name: flag(code) } } : {});
// only names from the bot's own list: whatever else the model says the language is never reaches the screen
const sourceName = card => card.sourceCode && languageName(card.sourceCode);

// one page of the translation (an embed holds 4096 chars); ◀ ▶ when there's more than one, "Not Spanish?", the dropdown
function translationView(key, secret, card, page) {
  const { pages, lang } = card;
  const buttons = [];
  if (pages.length > 1) {
    const arrow = (label, to, off) => new ButtonBuilder()
      .setCustomId(`tpage:${key}:${to}:${secret}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(off);
    buttons.push(arrow('◀', page - 1, page === 0), arrow('▶', page + 1, page === pages.length - 1));
  }
  buttons.push(new ButtonBuilder({ ...emojiOf(card.sourceCode) })
    .setCustomId(`tnot:${key}:${page}:${secret}`).setStyle(ButtonStyle.Secondary)
    .setLabel(sourceName(card) ? `Not ${sourceName(card)}?` : 'Wrong language?'));
  const picker = new StringSelectMenuBuilder()
    .setCustomId(`translate:${key}:${secret}`)
    .setPlaceholder('Translate to another language')
    .addOptions(LANGUAGES.map(code => ({ label: languageName(code), value: code, default: code === lang, ...emojiOf(code) })));
  const from = card.sourceCode ? withFlag(card.sourceCode) : 'Unknown';
  return {
    content: card.removed ? `⚠️ This translation tried to add ${card.removed === 1 ? 'a link or mention' : `${card.removed} links or mentions`} `
      + "that aren't in the original, so they were removed. Check the original message if anything looks off." : '',
    embeds: [translateEmbed({
      ...card, text: pages[page], languages: `${from} → ${withFlag(lang)}`, model: cloudModel,
      page: pages.length > 1 && `${page + 1}/${pages.length}`,
    })],
    components: [new ActionRowBuilder().addComponents(buttons), new ActionRowBuilder().addComponents(picker)],
  };
}

// "Not Spanish?": the model's likely alternatives (plus a "did you mean" after a typo) as buttons, then Other… and Back.
// The embed isn't sent, so Discord keeps showing the translation above.
function sourcePicker(key, secret, card, page, suggestion) {
  const codes = [...new Set([suggestion, ...card.alts].filter(Boolean))].slice(0, 5);
  const rows = [];
  if (codes.length) {
    rows.push(new ActionRowBuilder().addComponents(codes.map(code => new ButtonBuilder({ ...emojiOf(code) })
      .setCustomId(`tsrc:${key}:${code}:${secret}`).setLabel(languageName(code)).setStyle(ButtonStyle.Primary))));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tother:${key}:${page}:${secret}`).setLabel('Other…').setEmoji({ name: '✏️' }).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tback:${key}:${page}:${secret}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
  ));
  return {
    content: `What language is the original message in?${codes.length ? '' : ' Pick **Other…** to type it.'}`,
    components: rows,
  };
}

// Other…: Discord popups can't autocomplete, so this takes free text; findLanguage accepts names, native names and
// codes, and suggests the closest match on a typo
const languageModal = (key, secret, page) => new ModalBuilder()
  .setCustomId(`tmodal:${key}:${page}:${secret}`)
  .setTitle('What language is the original in?')
  .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
    .setCustomId('language').setLabel('Language').setPlaceholder('e.g. Portuguese, português, or pt')
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)));

// /switch and /close: only inside a chat channel, only its creator or an admin
async function onChatControl(interaction) {
  const chat = chatOf(interaction.channelId);
  if (!chat) return interaction.reply(ephemeral('This only works inside a chat channel made with `/chat`.'));
  if (!canControl(chat, interaction.user.id, isAdmin(interaction))) {
    return interaction.reply(ephemeral(`Only <@${chat.owner}> (or an admin) can do that here.`));
  }
  if (interaction.commandName === 'close') {
    await interaction.reply({ embeds: [noticeEmbed('👋 Closing this chat…')] });
    setTimeout(() => closeChat(interaction.channel), 3000);
    return;
  }
  const persona = await findPersona(interaction.options.getString('persona'));
  if (!persona) return interaction.reply(ephemeral('⚠️ Pick a persona from the list.'));
  return interaction.reply({ embeds: [await switchPersona(interaction.channel, chat, persona, interaction.user.id)] });
}

async function onConfig(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Admins only.'));
  const sub = interaction.options.getSubcommand();
  const show = s => (s.type === 'category' ? `<#${config[s.key]}>` : `**${config[s.key]}** ${s.unit}`);
  if (sub === 'show') {
    const lines = CONFIG_SPEC.map(s => `\`${s.name}\` ${show(s)} — ${s.description}`);
    return interaction.reply({ embeds: [noticeEmbed(`⚙️ **Settings**\n\n${lines.join('\n')}`)], flags: MessageFlags.Ephemeral });
  }
  const spec = CONFIG_SPEC.find(s => s.name === sub);
  config[spec.key] = spec.type === 'category' ? interaction.options.getChannel('value').id : interaction.options.getInteger('value');
  save();
  return interaction.reply(ephemeral(`✅ \`${spec.name}\` is now ${show(spec)}.`));
}
