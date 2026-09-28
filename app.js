import 'dotenv/config';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { client } from './client.js';
import { DiscordRequest } from './utils.js';
import { getPersonas, getPersonaReply, formatReply, linkMentions } from './utils/ai.js';

// Interactions arrive over the gateway (client.js), not HTTP: no Express server, no public URL, no PUBLIC_KEY.
const allowedChannelId = process.env.ALLOWED_CHANNEL_ID;
const spammingUsers = new Map();
let activeVoteWindow = null;
const ephemeral = content => ({ content, flags: MessageFlags.Ephemeral });
// a failed REST call in a timer (vote countdown, pingbomb) shouldn't take the whole bot down
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) return await onAutocomplete(interaction);
    if (interaction.isButton()) return await onButton(interaction);
    if (interaction.isChatInputCommand()) return await onCommand(interaction);
  } catch (err) {
    console.error(`Interaction failed (${interaction.commandName || interaction.customId}):`, err);
    if (interaction.isRepliable() && !interaction.replied) {
      const msg = '⚠️ Something went wrong.';
      await (interaction.deferred ? interaction.editReply(msg) : interaction.reply(ephemeral(msg))).catch(() => {});
    }
  }
});

// /chat persona picker (36 personas > Discord's 25 fixed choices, so autocomplete)
async function onAutocomplete(interaction) {
  if (interaction.commandName !== 'chat') return interaction.respond([]);
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
  const messageId = interaction.message.id;

  if (!state || !state.votingActive || state.messageId !== messageId) {
    return interaction.reply(ephemeral('Voting has already ended or this message is not active.'));
  }

  if (interaction.customId === 'vote_yes') {
    state.voters.add(interaction.user.id);
    await interaction.deferUpdate();
    if (state.voters.size >= 4) {
      state.votingActive = false;
      clearInterval(state.interval);
      await DiscordRequest(`/channels/${state.channelId}/messages`, {
        method: 'POST',
        body: { content: '@everyone 🚨 The vote has passed!' },
      });
      await DiscordRequest(`/channels/${state.channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: { content: '✅ Vote passed! Everyone has been pinged.', components: [] },
      });
      activeVoteWindow = null;
    }
    return;
  }

  if (interaction.customId === 'vote_revoke') {
    state.voters.delete(interaction.user.id);
    return interaction.deferUpdate();
  }
}

async function onCommand(interaction) {
  const name = interaction.commandName;
  const channelId = interaction.channelId;

  // Enforce channel restriction
  if (channelId !== allowedChannelId) {
    return interaction.reply(ephemeral('❌ This command can only be used in the designated channel.'));
  }

  if (name === 'test') {
    return interaction.reply('m');
  }

  if (name === 'chat') {
    const persona = interaction.options.getString('persona') || '';
    const prompt = interaction.options.getString('prompt') || '';
    const invoker = interaction.user.username;
    await interaction.deferReply();
    try {
      const { name: who, reply } = await getPersonaReply(persona, prompt, { channelId, appId: process.env.APP_ID, invoker });
      const { content, users } = await linkMentions(reply, interaction.guildId);
      // only the members the persona named get pinged — never @everyone/@here/roles
      await interaction.editReply({ content: formatReply(invoker, prompt, who, content), allowedMentions: { parse: [], users } });
    } catch (err) {
      console.error('Persona chat error:', err);
      await interaction.editReply(err.message.startsWith('unknown persona')
        ? '⚠️ Pick a persona from the list.'
        : '⚠️ The persona model is unreachable right now.');
    }
    return;
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

      const delay = Math.floor(Math.random() * 10000);
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
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const targetUserOption = interaction.options.getUser('user')?.id;
    let stoppedAny = false;

    if (targetUserOption) {
      const targetState = spammingUsers.get(targetUserOption);
      if (targetState && (targetState.startedBy === initiator || initiator === targetUserOption || isAdmin)) {
        spammingUsers.set(targetUserOption, { ...targetState, active: false });
        stoppedAny = true;
      }
    } else {
      for (const [targetUser, state] of spammingUsers.entries()) {
        if (state.startedBy === initiator || initiator === targetUser || isAdmin) {
          spammingUsers.set(targetUser, { ...state, active: false });
          stoppedAny = true;
        }
      }
    }

    return interaction.reply(stoppedAny
      ? `Pingbomb${targetUserOption ? ` for <@${targetUserOption}>` : (isAdmin ? 's have' : 's you started or are targeted by have')} been stopped.`
      : `You have no permission to stop that pingbomb.`);
  }

  if (name === 'help') {
    const helpText = `
**bruh** is a multifunctional Discord bot built using Node.js and discord.js.

---

## 🚀 Features

### \`/chat\`
Pick a persona and they reply to the chat in their own voice (fine-tuned model + past-chat memory).

### \`/pingbomb\`
Spam-pings a user randomly until stopped.

### \`/stopping\`
Stop pingbombs you've started or are targeted by.

### \`/everyone\`
Starts a 60s vote window to everyone if 4 users vote yes.

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

    const voters = new Set();
    const createdAt = Date.now();

    const buildMessage = () => {
      const secondsRemaining = 60 - Math.floor((Date.now() - createdAt) / 1000);
      return {
        content: `🗳️ Vote to ping everyone\n${voters.size}/4 votes — ${[...voters].map(id => `<@${id}>`).join(', ') || 'none'}\n⏳ ${secondsRemaining}s remaining`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vote_yes').setLabel('✅ Vote').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vote_revoke').setLabel('❌ Revoke').setStyle(ButtonStyle.Danger),
          ).toJSON(),
        ],
      };
    };

    const messageRes = await DiscordRequest(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: buildMessage(),
    });
    const message = await messageRes.json();

    const voteWindow = {
      voters,
      votingActive: true,
      createdAt,
      messageId: message.id,
      channelId,
      interval: null,
    };
    activeVoteWindow = voteWindow;

    voteWindow.interval = setInterval(async () => {
      const seconds = (Date.now() - voteWindow.createdAt) / 1000;
      if (seconds > 60) {
        voteWindow.votingActive = false;
        clearInterval(voteWindow.interval);
        await DiscordRequest(`/channels/${voteWindow.channelId}/messages/${voteWindow.messageId}`, {
          method: 'PATCH',
          body: { content: '🛑 Voting ended.', components: [] },
        });
        activeVoteWindow = null;
        return;
      }

      await DiscordRequest(`/channels/${voteWindow.channelId}/messages/${voteWindow.messageId}`, {
        method: 'PATCH',
        body: buildMessage(),
      });
    }, 5000);

    return interaction.reply('🗳️ Voting window opened. You have 60 seconds to vote.');
  }

  return interaction.reply(ephemeral('Unknown command.'));
}
