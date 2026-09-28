import 'dotenv/config';
import { capitalize, InstallGuildCommands } from './utils.js';
import { CONFIG_SPEC } from './utils/store.js';

const personaOption = description => ({ type: 3, name: 'persona', description, required: true, autocomplete: true });
const GUILD_ONLY = { integration_types: [0], contexts: [0] }; // chat channels + config only make sense inside the server

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
  description: 'Get a reply from someone in the group, in their voice',
  options: [
    {
      type: 3, // STRING
      name: 'persona',
      description: 'Who should reply',
      required: true,
      autocomplete: true, // list comes from the persona server (more than Discord's 25 fixed choices)
    },
    {
      type: 3, // STRING
      name: 'prompt',
      description: 'What you say to them',
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

const CREATE_CHAT_COMMAND = {
  name: 'create-chat',
  description: 'Open your own chat channel with a persona',
  type: 1,
  options: [
    personaOption('Who you want to chat with'),
    {
      type: 3, // STRING
      name: 'visibility',
      description: 'Private: only you (and admins) can see it. Public: everyone can join in.',
      required: true,
      choices: [{ name: 'private', value: 'private' }, { name: 'public', value: 'public' }],
    },
  ],
  ...GUILD_ONLY,
};

const SWITCH_COMMAND = {
  name: 'switch',
  description: 'Change who you are chatting with in this chat channel',
  type: 1,
  options: [personaOption('Who to switch to')],
  ...GUILD_ONLY,
};

const CLOSE_COMMAND = {
  name: 'close',
  description: 'Close this chat channel (deletes it)',
  type: 1,
  ...GUILD_ONLY,
};

// /config <setting> value:<...> — built from CONFIG_SPEC so the command and the bot's validation never drift
const CONFIG_COMMAND = {
  name: 'config',
  description: 'Bot settings (admins only)',
  type: 1,
  default_member_permissions: '8', // Administrator: hidden from everyone else
  options: [
    { type: 1, name: 'show', description: 'Show all settings' },
    ...CONFIG_SPEC.map(s => ({
      type: 1, // SUB_COMMAND
      name: s.name,
      description: s.description.slice(0, 100),
      options: [s.type === 'category'
        ? { type: 7, name: 'value', description: 'Category', required: true, channel_types: [4] }
        : { type: 4, name: 'value', description: `${s.min}-${s.max} ${s.unit}`, required: true, min_value: s.min, max_value: s.max }],
    })),
  ],
  ...GUILD_ONLY,
};

const ALL_COMMANDS = [TEST_COMMAND, PINGBOMB_COMMAND, STOPPING_COMMAND, CHAT_COMMAND, HELP_COMMAND, EVERYONE_COMMAND,
  CREATE_CHAT_COMMAND, SWITCH_COMMAND, CLOSE_COMMAND, CONFIG_COMMAND];

InstallGuildCommands(process.env.APP_ID, process.env.GUILD_ID, ALL_COMMANDS)
  .then(() => console.log("✅ Slash commands registered successfully"))
  .catch((err) => console.error("❌ Failed to register commands:", err));

