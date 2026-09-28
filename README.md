# bruh - A Discord Bot

**bruh** is a multifunctional Discord bot built using Node.js, Express, and the Discord Interactions API. It includes interactive features like AI chatbot responses, utility commands, and fun spam commands.

---

## 🚀 Features

> ℹ️ All slash commands are restricted to the channel set by `ALLOWED_CHANNEL_ID`. Used anywhere else, the bot replies with an ephemeral error.

### `/chat`
Someone from the group replies to the chat, in their own voice.

- **Usage**: `/chat persona: <pick from the list> prompt: <what you say to them>`
- **Response**: `> **you**: prompt` then `**persona**: reply`. The reply comes from `bruh-persona:v2` (Qwen3-1.7B fine-tuned on the group's messages) running locally in Ollama.
- **Context**: the last ~30 channel messages are read (only the current conversation — anything before a 45-minute gap is dropped), so the persona answers what's actually being talked about. Earlier `/chat` replies count as that persona's messages, so follow-ups keep the thread.
- **Memory (RAG)**: each reply gets 3 of the persona's own past lines (voice) and, when confidently relevant, up to 2 snippets of past conversations (facts). A persona only "remembers" DMs they were in.
- **Pings**: when a persona writes `@name`, it pings whichever server member has that exact username, display name, or nickname (multi-word names like `@The Living Meme` work). `@everyone`, `@here`, and roles are never pinged. If names stay plain text, turn on **Server Members Intent** in the Developer Portal.

---

## 🧠 Persona model setup

`/chat` needs two things running next to the bot (see `bruh-data/Scripts/Phase_7`):

1. **Ollama** with the model: `ollama create bruh-persona:v2 -f Modelfile` in the `outputs/v2/gguf` bundle.
2. **The persona server**, which builds prompts exactly like the training data (style card, retrieval, formatting):
   ```bash
   cd bruh-data
   pip install -r Scripts/Phase_7/requirements.txt       # numpy, scipy, scikit-learn
   python Scripts/Phase_7/persona_server.py --bundle outputs/v2/gguf --model bruh-persona:v2
   ```
   It listens on `127.0.0.1:8787`. If it runs on another machine, set `PERSONA_API_URL` in the bot's `.env`.

Discord side:
- **Developer Portal → Bot → Message Content Intent: ON** (otherwise channel history comes back empty and personas only see the prompt).
- The bot needs **Read Message History** in the allowed channel.
- Re-register commands after updating: `npm run register` (adds the `persona` option).

`.env`: `APP_ID`, `PUBLIC_KEY`, `DISCORD_TOKEN`, `TOKEN`, `GUILD_ID`, `ALLOWED_CHANNEL_ID`, optional `PERSONA_API_URL`. `OLLAMA_API_KEY` is no longer used.

Keep the persona server running on the N150 with systemd, e.g. `/etc/systemd/system/bruh-persona.service`:
```ini
[Unit]
After=network.target ollama.service
[Service]
WorkingDirectory=/path/to/bruh-data
ExecStart=/usr/bin/python3 Scripts/Phase_7/persona_server.py --bundle outputs/v2/gguf
Restart=always
[Install]
WantedBy=multi-user.target
```

---

### `/pingbomb`
Spam-pings a specified user randomly until stopped.

- **Usage**: `/pingbomb user: @target`
- **Permissions**: No special permissions required to initiate.
- **Behavior**: Sends pings at random intervals between 0–10 seconds. Only one pingbomb can target a given user at a time.

---

### `/stopping`
Stops active pingbombs.

- **Usage**:
  - `/stopping` — stops pingbombs you initiated or that are targeting you.
  - `/stopping user: @target` — attempts to stop pingbomb for a specific user.
- **Permissions**: Admins can stop any pingbomb.

---

### `/everyone`
Opens a vote window to mention `@everyone`, if enough people agree.

- **Usage**: `/everyone`
- **Behavior**: Posts a message with ✅ Vote and ❌ Revoke buttons. The tally and countdown refresh every 5 seconds. Once 4 users have voted yes, the bot pings `@everyone` and closes the vote; otherwise the window expires after 60 seconds.
- **Note**: Only one vote window can be open at a time.

---

### `/help`
Lists every command and what it does.

- **Usage**: `/help`
- **Response**: Posts a condensed version of this feature list in the channel.

---

### `/test`
A simple test command to check if the bot is responding.

- **Usage**: `/test`
- **Response**: Replies with "m" (test string).

---
