import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'm', type: 0 }],
    status: 'online',
  });
});

client.login(process.env.TOKEN);
