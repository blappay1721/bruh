# bruh - A Discord Bot

**bruh** is a multifunctional Discord bot built using Node.js and discord.js. It includes interactive features like AI chatbot responses, utility commands, and fun spam commands.

Slash commands arrive over the bot's gateway connection, so it runs anywhere with outbound internet — no public URL, tunnel, or open ports. **Keep the Developer Portal's Interactions Endpoint URL empty** (if it's set, Discord sends commands there instead of to the bot).

---

## 🚀 Features

> ℹ️ Slash commands are restricted to the channel set by `ALLOWED_CHANNEL_ID` (used anywhere else, the bot replies with an ephemeral error). Exceptions: `/switch` and `/close` work inside chat channels, `/stopping` and `/config` work anywhere.

### `/ai`
A real assistant for actual questions: `gpt-oss:120b` on Ollama Cloud.

- **Usage**: `/ai prompt: <your question>`
- **Response**: your question, then the answer (long answers continue in follow-up messages). The AI can't ping anyone.
- **Setup**: create an API key at ollama.com (Settings → Keys) and put it in `.env` as `OLLAMA_API_KEY`. Optional `OLLAMA_MODEL` swaps the model.

---

### `/msg`
Someone from the group replies to the chat, in their own voice.

- **Usage**: `/msg persona: <pick from the list> prompt: <what you say to them>`
- **Response**: two cards — your prompt (your name + avatar, cut at 300 chars) and the persona's reply (their name, their real Discord avatar if they're in the server, and a fixed color per persona). The reply comes from `bruh-persona:v2` (Qwen3-1.7B fine-tuned on the group's messages) running locally in Ollama, capped at ~120 tokens.
- **Context**: one-off by default — the persona only sees your prompt. Set `PERSONA_CONTEXT=1` in `.env` to also send the last 30 channel messages (only the current conversation: anything before a 45-minute gap is dropped, and the server keeps the last 8 turns). In that mode earlier `/msg` exchanges are read back from their cards, so follow-ups keep the thread.
- **Memory (RAG)**: each reply gets 3 of the persona's own past lines (voice) and, when confidently relevant, up to 2 snippets of past conversations (facts). A persona only "remembers" DMs they were in.
- **Pings**: when a persona writes `@name`, it pings whichever server member has that exact username, display name, or nickname (multi-word names like `@The Living Meme` work). Pings go in the message text above the cards, since embeds can't ping. `@everyone`, `@here`, and roles are never pinged. If names stay plain text (and avatars are missing), turn on **Server Members Intent** in the Developer Portal.

---

### `/chat`
Opens your own channel to chat with a persona — just type, and they answer.

- **Usage**: `/chat persona: <pick> visibility: private|public`
- **Private**: only you, the bot, and admins can see it. The persona posts as themselves (their name + avatar, through a webhook), and a multi-line answer arrives as separate messages, like a real burst.
- **Public**: same visibility as the chat category, so anyone can join in. Each person gets their own answer, as a reply card to their latest message (without pinging them), in the order they wrote. Up to 5 people can be waiting at once; beyond that the oldest is dropped. Other people's unanswered messages are left out of each reply's context.
- Replies use the recent conversation in that channel (the server keeps the last 8 turns — the window the model was trained on). Messages sent within 2 seconds of each other get one answer. Persona lines from before a `/switch` stay attributed to the earlier persona.
- Channels are created at the bottom of the chat category, named like `💬-saintsf-bernard`, starting with an intro card.
- One open chat per person (admins: `/config chat-limit`, 0 = no limit). Idle chats get a warning about a minute before closing, then are deleted after 10 minutes without messages (`/config chat-timeout`). Open chats are saved in `data/state.json`, so they survive restarts; channels deleted by hand are forgotten.

### `/switch`
Inside a chat channel: talk to a different persona. `/switch persona: <pick>` — only the chat's creator or an admin.

### `/close`
Inside a chat channel: deletes it. Only the chat's creator or an admin.

### `/config` (admins only)
`/config show` lists everything. Settings: `chat-timeout`, `chat-limit`, `chat-category`, `vote-threshold`, `vote-duration`, `pingbomb-interval`. Saved in `data/state.json`, so they survive restarts.

> Chat channels need the bot to have **Manage Channels** and **Manage Webhooks** in the chat category.

---

## 🧠 Persona model setup

`/msg` and `/chat` need two things running next to the bot (see `bruh-data/Scripts/Phase_7`):

1. **Ollama** with the model: `ollama create bruh-persona:v2 -f Modelfile` in the `outputs/v2/gguf` bundle.
2. **The persona server**, which builds prompts exactly like the training data (style card, retrieval, formatting):
   ```bash
   cd bruh-data
   pip install -r Scripts/Phase_7/requirements.txt       # numpy, scipy, scikit-learn
   python Scripts/Phase_7/persona_server.py --bundle outputs/v2/gguf --model bruh-persona:v2
   ```
   It listens on `127.0.0.1:8787`. If it runs on another machine, set `PERSONA_API_URL` in the bot's `.env`.

The persona list (for autocomplete) is fetched from the server's `GET /personas` and cached for 10 minutes. Replies come from `POST /chat`; the bot waits up to 170s for one (CPU box).

Discord side:
- **Developer Portal → Bot → Message Content Intent: ON**. `/chat` channels can't read what people type without it (and `/msg` context mode sees empty history).
- **Server Members Intent: ON** for `@name` pings and persona avatars.
- The bot needs **Manage Channels** and **Manage Webhooks** in the chat category, and **Read Message History** in the allowed channel when `PERSONA_CONTEXT=1`.
- Re-register commands after updating: `npm run register`.

`.env`: `APP_ID`, `TOKEN` (gateway login), `DISCORD_TOKEN` (REST calls; the same bot token), `GUILD_ID`, `ALLOWED_CHANNEL_ID`, `OLLAMA_API_KEY` (for `/ai`). Optional: `PERSONA_API_URL`, `PERSONA_CONTEXT=1`, `OLLAMA_MODEL`, `STATE_FILE` (default `data/state.json`). `PUBLIC_KEY` is no longer used.

Keep the persona server running with systemd, e.g. `/etc/systemd/system/bruh-persona.service`:
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
- **Behavior**: Opens a `💣-pingbomb-<user>` channel in the chat category (same visibility as the category, anyone can chat there) and pings at random intervals up to `pingbomb-interval` seconds. Only one pingbomb can target a given user at a time. Stopping it deletes the channel after 5s.

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

- **Usage**: `/everyone message:<what it's about>`
- **Behavior**: Posts a vote card with your message, a live countdown, and the list of who has voted yes. After voting you get a message only you can see, with a red Revoke vote button. Once 4 users vote yes (`/config vote-threshold`), the card turns green and lists the voters, and the bot pings `@everyone` with your message. If time runs out (60s, `/config vote-duration`), the same card turns red and says the vote failed.
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
