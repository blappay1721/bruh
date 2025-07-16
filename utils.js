import 'dotenv/config';

export async function DiscordRequest(endpoint, options) {
  const url = 'https://discord.com/api/v10/' + endpoint;

  if (options.body) options.body = JSON.stringify(options.body);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)',
      },
      ...options
    });

    if (!res.ok) {
      let errData;
      try {
        errData = await res.json();
      } catch {
        errData = await res.text();
      }

      console.error(`❌ Discord API error (${res.status}):`, errData);
      throw new Error(`Discord API ${res.status}: ${JSON.stringify(errData)}`);
    }

    return res;
  } catch (err) {
    console.error('❌ DiscordRequest failed:', err.message);
    throw err;
  }
}

export async function InstallGlobalCommands(appId, commands) {
  const endpoint = `applications/${appId}/commands`;

  try {
    await DiscordRequest(endpoint, { method: 'PUT', body: commands });
    console.log('✅ Registered global commands');
  } catch (err) {
    console.error('❌ Failed to register global commands:', err.message);
  }
}

export async function InstallGuildCommands(appId, guildId, commands) {
  const endpoint = `applications/${appId}/guilds/${guildId}/commands`;

  try {
    const res = await DiscordRequest(endpoint, {
      method: 'PUT',
      body: commands,
    });
    console.log('✅ Registered guild commands');
    return res;
  } catch (err) {
    console.error('❌ Failed to register guild commands:', err.message);
  }
}

export function getRandomEmoji() {
  const emojiList = ['😭','😄','😌','🤓','😎','😤','🤖','😶‍🌫️','🌏','📸','💿','👋','🌊','✨'];
  return emojiList[Math.floor(Math.random() * emojiList.length)];
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

