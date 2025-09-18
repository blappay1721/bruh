import './client.js';
import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils.js';
import { getAIResponse } from './utils/ai.js';

const app = express();
const PORT = process.env.PORT || 3000;
const allowedChannelId = process.env.ALLOWED_CHANNEL_ID;
const spammingUsers = new Map();
let activeVoteWindow = null;

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { type, data } = req.body;
  const channelId = req.body.channel_id;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  // Handle BUTTONS (e.g. voting)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const { custom_id } = req.body.data;
    const userId = req.body.member.user.id;
    const messageId = req.body.message.id;

    const state = activeVoteWindow;

    if (!state || !state.votingActive || state.messageId !== messageId) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Voting has already ended or this message is not active.',
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    if (custom_id === 'vote_yes') {
      state.voters.add(userId);
      if (state.voters.size >= 4) {
        state.votingActive = false;
        clearInterval(state.interval);
        await DiscordRequest(`/channels/${state.channelId}/messages`, {
          method: 'POST',
          body: { content: '@everyone 🚨 The vote has passed!' },
        });
        await DiscordRequest(`/channels/${state.channelId}/messages/${messageId}`, {
          method: 'PATCH',
          body: {
            content: '✅ Vote passed! Everyone has been pinged.',
            components: [],
          },
        });
        activeVoteWindow = null;
      }
      return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
    }

    if (custom_id === 'vote_revoke') {
      state.voters.delete(userId);
      return res.send({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
    }
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // Enforce channel restriction
    if (channelId !== allowedChannelId) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ This command can only be used in the designated channel.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      });
    }

    if (name === 'test') {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `m` },
      });
    }

    if (name === 'chat') {
      const prompt = data.options?.find(opt => opt.name === 'prompt')?.value || '';
      res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

      try {
        const reply = await getAIResponse(prompt);
        const chunks = reply.match(/[\s\S]{1,2000}/g) || ['(empty response)'];

        await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: `**You asked:** ${prompt}\n\n${chunks[0]}` },
        });

        for (let i = 1; i < chunks.length; i++) {
          await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}`, {
            method: 'POST',
            body: { content: `*(continued)*\n${chunks[i]}` },
          });
        }
      } catch (err) {
        console.error('AI error:', err);
        await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: '⚠️ Failed to fetch response from the AI.' },
        });
      }
      return;
    }

    if (name === 'pingbomb') {
      const user = data.options.find(opt => opt.name === 'user').value;
      const initiator = req.body.member.user.id;

      if (spammingUsers.has(user) && spammingUsers.get(user).active) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `<@${user}> is already being pingbombed by <@${spammingUsers.get(user).startedBy}>.`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Starting a pingbomb on <@${user}> initiated by <@${initiator}>...`,
        },
      });

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
      const initiator = req.body.member.user.id;
      const perms = BigInt(req.body.member.permissions || 0);
      const isAdmin = (perms & 0x00000008n) === 0x00000008n;
      const targetUserOption = data.options?.find(opt => opt.name === 'user')?.value;
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

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: stoppedAny
            ? `Pingbomb${targetUserOption ? ` for <@${targetUserOption}>` : (isAdmin ? 's have' : 's you started or are targeted by have')} been stopped.`
            : `You have no permission to stop that pingbomb.`,
        },
      });
    }

    if (name === 'help') {
      const helpText = `
**bruh** is a multifunctional Discord bot built using Node.js, Express, and the Discord Interactions API.

---

## 🚀 Features

### \`/chat\`
Ask the bot any question, and get an AI-generated response using OpenRouter.

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

      res.send({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

      try {
        await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: chunks[0] },
        });

        for (let i = 1; i < chunks.length; i++) {
          await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}`, {
            method: 'POST',
            body: { content: chunks[i] },
          });
        }
      } catch (err) {
        console.error('Help command failed:', err);
      }
      return;
    }

    if (name === 'everyone') {
      if (activeVoteWindow?.votingActive) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '⚠️ A vote is already in progress. Please wait for it to end.',
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }

      const voters = new Set();
      const createdAt = Date.now();

      const buildMessage = () => {
        const secondsRemaining = 60 - Math.floor((Date.now() - createdAt) / 1000);
        return {
          content: `🗳️ Vote to ping everyone\n${voters.size}/4 votes — ${[...voters].map(id => `<@${id}>`).join(', ') || 'none'}\n⏳ ${secondsRemaining}s remaining`,
          components: [
            {
              type: MessageComponentTypes.ACTION_ROW,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  custom_id: 'vote_yes',
                  label: '✅ Vote',
                  style: ButtonStyleTypes.SUCCESS,
                },
                {
                  type: MessageComponentTypes.BUTTON,
                  custom_id: 'vote_revoke',
                  label: '❌ Revoke',
                  style: ButtonStyleTypes.DANGER,
                },
              ],
            },
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
            body: {
              content: '🛑 Voting ended.',
              components: [],
            },
          });
          activeVoteWindow = null;
          return;
        }

        await DiscordRequest(`/channels/${voteWindow.channelId}/messages/${voteWindow.messageId}`, {
          method: 'PATCH',
          body: buildMessage(),
        });
      }, 5000);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '🗳️ Voting window opened. You have 60 seconds to vote.' },
      });
    }

    return res.status(400).json({ error: 'unknown command' });
  }

  return res.status(400).json({ error: 'unknown interaction type' });
});

app.get('/', (req, res) => {
  res.send('bruh is alive!');
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

