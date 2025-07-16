import 'dotenv/config';
import { capitalize, InstallGlobalCommands } from './utils.js';

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

const ALL_COMMANDS = [TEST_COMMAND, PINGBOMB_COMMAND, STOPPING_COMMAND, CHAT_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS)
  .then(() => console.log("✅ Slash commands registered successfully"))
  .catch((err) => console.error("❌ Failed to register commands:", err));

