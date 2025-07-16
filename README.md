# bruh - A Discord Bot

**bruh** is a multifunctional Discord bot built using Node.js, Express, and the Discord Interactions API. It includes interactive features like AI chatbot responses, utility commands, and fun spam commands.

---

## 🚀 Features

### `/chat`
Ask the bot any question, and get an AI-generated response using OpenRouter (free LLM API proxy).

- **Usage**: `/chat prompt: <your message>`
- **Response**: The bot will reply using the DeepSeek Chat model (or any configured OpenRouter-compatible model).
- **Supports multi-part messages** if reply exceeds Discord’s 2000 character limit.

> ⚠️ Prompt only supports text currently

---

### `/pingbomb`
Spam-pings a specified user randomly until stopped.

- **Usage**: `/pingbomb user: @target`
- **Permissions**: No special permissions required to initiate.
- **Behavior**: Sends pings at random intervals between 0–10 seconds.

---

### `/stopping`
Stops active pingbombs.

- **Usage**:
  - `/stopping` — stops pingbombs you initiated or that are targeting you.
  - `/stopping user: @target` — attempts to stop pingbomb for a specific user.
- **Permissions**: Admins can stop any pingbomb.

---

### `/test`
A simple test command to check if the bot is responding.

- **Usage**: `/test`
- **Response**: Replies with "m" (test string).

---
