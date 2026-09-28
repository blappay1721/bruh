// Settings (/config) + open chat channels, persisted to data/state.json so a restart keeps both.
import fs from 'fs';
import path from 'path';

const FILE = path.resolve(process.env.STATE_FILE || 'data/state.json');

// /config settings: commands.js builds the subcommands from this, app.js validates with it
export const CONFIG_SPEC = [
  { key: 'chatTimeoutMin', name: 'chat-timeout', type: 'int', min: 1, max: 1440, unit: 'min', default: 10,
    description: 'Delete chat channels after this many minutes without messages' },
  { key: 'chatLimit', name: 'chat-limit', type: 'int', min: 0, max: 20, unit: 'chats', default: 1,
    description: 'Open chat channels allowed per person (0 = no limit)' },
  { key: 'chatCategoryId', name: 'chat-category', type: 'category', default: '1554198351975809164',
    description: 'Category where chat channels are created' },
  { key: 'voteThreshold', name: 'vote-threshold', type: 'int', min: 1, max: 50, unit: 'votes', default: 4,
    description: 'Votes needed for /everyone to ping everyone' },
  { key: 'voteSeconds', name: 'vote-duration', type: 'int', min: 10, max: 600, unit: 's', default: 60,
    description: 'How long an /everyone vote stays open' },
  { key: 'pingbombMaxDelaySec', name: 'pingbomb-interval', type: 'int', min: 1, max: 120, unit: 's', default: 10,
    description: 'Longest random wait between /pingbomb pings' },
];

function load() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch { /* first run */ }
  const defaults = Object.fromEntries(CONFIG_SPEC.map(s => [s.key, s.default]));
  return { config: { ...defaults, ...(data.config || {}) }, chats: data.chats || {} };
}

export const state = load();
export const config = state.config;

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(FILE + '.tmp', FILE); // atomic: a crash mid-write can't corrupt the state file
}

let pending = null;
export function saveSoon() { // for high-frequency updates (message activity)
  clearTimeout(pending);
  pending = setTimeout(save, 2000);
}
