import 'dotenv/config';
import { getRPSChoices } from './game.js';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Get the game choices from game.js
function createCommandChoices() {
  const choices = getRPSChoices();
  const commandChoices = [];

  for (let choice of choices) {
    commandChoices.push({
      name: capitalize(choice),
      value: choice.toLowerCase(),
    });
  }

  return commandChoices;
}

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
  description: 'Stop pinging a user',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ALL_COMMANDS = [TEST_COMMAND, PINGBOMB_COMMAND, STOPPING_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
