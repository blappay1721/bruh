import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

// Slash commands, autocomplete and buttons arrive over this gateway connection (app.js),
// so no public URL / tunnel is needed. Keep the Developer Portal's Interactions Endpoint URL empty.
export const client = new Client({
  // GuildMessages + MessageContent: chat channels answer normal messages (Message Content Intent must be ON in the portal)
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'm', type: 0 }],
    status: 'online',
  });
});

client.login(process.env.TOKEN).catch(err => {
  console.error('Discord login failed (check TOKEN in .env):', err.message);
  process.exit(1); // let systemd show the failure instead of running without a connection
});
