# bruh - A Discord Bot

**bruh** is a multifunctional Discord bot built using Node.js, Express, and the Discord Interactions API. It includes interactive features like AI chatbot responses, utility commands, and fun spam commands.

---

## 🚀 Features

> ℹ️ All slash commands are restricted to the channel set by `ALLOWED_CHANNEL_ID`. Used anywhere else, the bot replies with an ephemeral error.

### `/chat`
Ask the bot any question, and get an AI-generated response.

- **Usage**: `/chat prompt: <your message>`
- **Response**: The bot will reply using DeepSeek V3.1 (671B) through the Ollama Cloud API.
- **Supports multi-part messages** if reply exceeds Discord’s 2000 character limit.

> ⚠️ Prompt only supports text currently

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
