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
import { getShuffledOptions, getResult } from './game.js';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames = {};

const spammingUsers = new Map();

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `m`,
        },
      });
    }

    // ------------------------------
    // /pingbomb Command
    // ------------------------------
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

        const delay = Math.floor(Math.random() * 10000); // 0–10 sec
        setTimeout(() => {
          DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}`, {
            method: 'POST',
            body: {
              content: `<@${user}> ping ${i}`,
            },
          });
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
      let stoppedAny = false;

      for (const [targetUser, state] of spammingUsers.entries()) {
        if (state.startedBy === initiator || req.body.member.permissions === 'ADMINISTRATOR') {
          spammingUsers.set(targetUser, { ...state, active: false });
          stoppedAny = true;
        }
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: stoppedAny
            ? `Pingbombs initiated by you have been stopped.`
            : `You have no active pingbombs to stop.`,
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
