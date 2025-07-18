import 'dotenv/config';
import { capitalize, InstallGuildCommands } from './utils.js';

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'test command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const PINGBOMB_COMMAND = {
  name: 'pingbomb',
  description: 'Ping someone multiple times',
  options: [
    {
      type: 6, // USER type
      name: 'user',
      description: 'User to ping',
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const STOPPING_COMMAND = {
  name: 'stopping',
  description: 'Stop pinging a user (or all if admin)',
  options: [
    {
      type: 6, // USER
      name: 'user',
      description: 'User whose pingbomb to stop (optional)',
      required: false,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const CHAT_COMMAND = {
  name: 'chat',
  description: 'Chat with bruh bot',
  options: [
    {
      type: 3, // STRING
      name: 'prompt',
      description: 'Message to send to the bot',
      required: true,
    },
  ],
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const HELP_COMMAND = {
  name: 'help',
  description: 'Show info about all the commands',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const EVERYONE_COMMAND = {
  name: 'everyone',
  description: 'Open a vote window to mention @everyone if enough people agree',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [TEST_COMMAND, PINGBOMB_COMMAND, STOPPING_COMMAND, CHAT_COMMAND, HELP_COMMAND, EVERYONE_COMMAND];

InstallGuildCommands(process.env.APP_ID, process.env.GUILD_ID, ALL_COMMANDS)
  .then(() => console.log("✅ Slash commands registered successfully"))
  .catch((err) => console.error("❌ Failed to register commands:", err));

