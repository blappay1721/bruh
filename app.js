import 'dotenv/config';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { client } from './client.js';
import { DiscordRequest } from './utils.js';
import { askCloud, cloudModel, findPersona, getPersonas, getPersonaReply, linkMentions, personaAvatar } from './utils/ai.js';
import { aiEmbeds, chatEmbeds, noticeEmbed, voteEmbed } from './utils/look.js';
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
client.on('channelDelete', channel => forget(channel.id)); // deleted by hand: stop tracking it

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) return await onAutocomplete(interaction);
    if (interaction.isButton()) return await onButton(interaction);
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
      console.error('Ollama Cloud error:', err.message);
      return interaction.editReply(err.message === 'busy' ? '⏳ The AI is rate-limited right now. Try again in a minute.'
        : '⚠️ The AI is unreachable right now.');
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
      const { reply } = await getPersonaReply(persona.id, prompt, { channelId, appId: process.env.APP_ID, invoker });
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
    const user = interaction.options.getUser('user').id;
    const initiator = interaction.user.id;

    if (spammingUsers.has(user) && spammingUsers.get(user).active) {
      return interaction.reply(ephemeral(`<@${user}> is already being pingbombed by <@${spammingUsers.get(user).startedBy}>.`));
    }

    await interaction.reply(`Starting a pingbomb on <@${user}> initiated by <@${initiator}>...`);
    spammingUsers.set(user, { active: true, startedBy: initiator });

    const spamLoop = (i = 1) => {
      const state = spammingUsers.get(user);
      if (!state || !state.active) return;

      const delay = Math.floor(Math.random() * config.pingbombMaxDelaySec * 1000);
      setTimeout(async () => {
        try {
          await DiscordRequest(`/channels/${channelId}/messages`, {
            method: 'POST',
            body: { content: `<@${user}> ping ${i}` },
          });
        } catch (error) {
          console.error(`Failed to send ping #${i}:`, error);
        }
        spamLoop(i + 1);
      }, delay);
    };

    spamLoop();
    return;
  }

  if (name === 'stopping') {
    const initiator = interaction.user.id;
    const admin = isAdmin(interaction);
    const targetUserOption = interaction.options.getUser('user')?.id;
    let stoppedAny = false;

    if (targetUserOption) {
      const targetState = spammingUsers.get(targetUserOption);
      if (targetState && (targetState.startedBy === initiator || initiator === targetUserOption || admin)) {
        spammingUsers.set(targetUserOption, { ...targetState, active: false });
        stoppedAny = true;
      }
    } else {
      for (const [targetUser, state] of spammingUsers.entries()) {
        if (state.startedBy === initiator || initiator === targetUser || admin) {
          spammingUsers.set(targetUser, { ...state, active: false });
          stoppedAny = true;
        }
      }
    }

    return interaction.reply(stoppedAny
      ? `Pingbomb${targetUserOption ? ` for <@${targetUserOption}>` : (admin ? 's have' : 's you started or are targeted by have')} been stopped.`
      : `You have no permission to stop that pingbomb.`);
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
