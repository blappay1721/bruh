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
const activeGames = {};
const spammingUsers = new Map();

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { id, type, data } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'test') {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `m` },
      });
    }

    // ------------------------------
    // /chat Command
    // ------------------------------
    if (name === 'chat') {
      const prompt = data.options?.find(opt => opt.name === 'prompt')?.value || '';

      // Acknowledge command to avoid timeout
      res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });

      try {
        const reply = await getAIResponse(prompt);
        const chunks = reply.match(/[\s\S]{1,2000}/g) || ['(empty response)'];

        // First chunk edits original deferred message and includes prompt
        await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
          method: 'PATCH',
          body: {
            content: `**You asked:** ${prompt}\n\n${chunks[0]}`,
          },
        });

        // Remaining chunks are sent as follow-ups
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

    // ------------------------------
    // /pingbomb Command
    // ------------------------------
    if (name === 'pingbomb') {
      const user = data.options.find(opt => opt.name === 'user').value;
      const initiator = req.body.member.user.id;
      const channelId = req.body.channel_id;

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

    // ------------------------------
    // /stopping Command
    // ------------------------------
    if (name === 'stopping') {
      const initiator = req.body.member.user.id;
      const perms = BigInt(req.body.member.permissions || 0);
      const isAdmin = (perms & 0x00000008n) === 0x00000008n;

      const targetUserOption = data.options?.find(opt => opt.name === 'user')?.value;
      let stoppedAny = false;

      if (targetUserOption) {
        const targetState = spammingUsers.get(targetUserOption);
        if (targetState) {
          if (
            targetState.startedBy === initiator ||
            initiator === targetUserOption ||
            isAdmin
          ) {
            spammingUsers.set(targetUserOption, { ...targetState, active: false });
            stoppedAny = true;
          }
        }
      } else {
        for (const [targetUser, state] of spammingUsers.entries()) {
          if (
            state.startedBy === initiator ||
            initiator === targetUser ||
            isAdmin
          ) {
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

    // ------------------------------
    // /help Command
    // ------------------------------
	if (name === 'help') {
	  const helpText = `
	**bruh** is a multifunctional Discord bot built using Node.js, Express, and the Discord Interactions API.

	---

	## 🚀 Features

	### \`/chat\`
	Ask the bot any question, and get an AI-generated response using OpenRouter (free LLM API proxy).
	- **Usage**: \`/chat prompt: <your message>\`
	- **Response**: Replies using the DeepSeek Chat model.
	- **Supports multi-part messages** if reply exceeds Discord’s 2000 character limit.

	> ⚠️ Prompt only supports text currently

	---

	### \`/pingbomb\`
	Spam-pings a specified user randomly until stopped.
	- **Usage**: \`/pingbomb user: @target\`
	- **Behavior**: Sends pings every 0–10 seconds.

	---

	### \`/stopping\`
	Stops active pingbombs.
	- **Usage**: \`/stopping\` or \`/stopping user: @target\`
	- **Permissions**: Admins can stop any.

	---

	### \`/test\`
	Test command to check if the bot is responsive.
	`;

	  // Discord response limit is 2000 characters
	  const chunks = helpText.match(/[\s\S]{1,2000}/g) || ['No help content'];

	  res.send({
		type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
	  });

	  try {
		// Send main chunk first
		await DiscordRequest(`/webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, {
		  method: 'PATCH',
		  body: { content: chunks[0] },
		});

		// Send any follow-up chunks
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

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.get('/', (req, res) => {
  res.send('bruh is alive!');
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

