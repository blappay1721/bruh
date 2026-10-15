# bruh Privacy Policy

**Effective:** October 14, 2026

This policy explains what the **bruh** Discord app ("the bot") does with your information. The bot is a hobby project run by an individual (GitHub: [blappay1721](https://github.com/blappay1721)), not a company. The bot's full source code is public at [github.com/blappay1721/bruh](https://github.com/blappay1721/bruh), so you can check everything described here.

**The short version:** the bot only handles what it needs to answer the command you used. It doesn't sell your data, show ads, run analytics, or build profiles. Almost everything it holds lives in memory and is gone when the bot restarts. Message text is never logged.

---

## 1. What the bot receives

Discord sends the bot information when you use one of its commands, buttons or menus:

- **Your account basics:** user ID, username, display name, avatar, and your Discord app language.
- **Where you used it:** server and channel IDs.
- **What you sent:** the command and what you typed into it.
- **For Translate:** the text of the message you chose to translate.
- **In `/chat` channels** (private server only, §3): the messages typed there. This is the only place the bot reads ordinary messages.

The bot does **not** read messages anywhere else, track your activity, or see servers it isn't in. In servers where the bot hasn't been added, it only sees what Discord sends with your command, e.g. the one message you chose to translate.

## 2. What each feature does with it

| Feature | What's used | Where it goes | Who sees the result |
|---|---|---|---|
| **Translate** / `/translate` | The text to translate and your app language | Ollama Cloud (see §4) | Only you |
| `/ai` | Your question and your username | Ollama Cloud (see §4) | Everyone in the channel |
| `/msg`, `/chat` | Only in the operator's private server (§3) | — | — |
| `/everyone`, `/pingbomb`, `/stopping` | User IDs of who voted, started or was targeted | Nowhere (bot memory only) | The channel |
| `/config` | Server settings | Saved on disk (§5) | Admins |

## 3. Private-server features

`/msg` and `/chat` only work in the operator's private community server, whose members have agreed to how they work. They aren't available anywhere else.

## 4. Ollama Cloud

`/ai` and Translate send text to [Ollama](https://ollama.com)'s cloud models to generate the answer or translation. Ollama processes it under its own [Privacy Policy](https://ollama.com/privacy), which says prompts to cloud models are handled transiently and not used for training. The bot sends only the text needed for the request (plus your username for `/ai`), never your user ID.

## 5. What's stored, and for how long

**On disk** (one file on the operator's computer, `data/state.json`):
- Bot settings set with `/config`.
- For each open `/chat` channel (private server only): who opened it and when. This is deleted as soon as the chat closes.

**In memory only** (gone whenever the bot restarts):
- **Translations,** to avoid repeat work: up to 2,000 recent translations. Each is **encrypted with a key derived from the original text**, so they can't be read without already having that text. The cache never holds the original message text in readable form.
- **Your open translation cards,** so the language menu and page buttons work: up to 500, each encrypted with a random key that exists only in that card's buttons, never in the bot.
- **Rate-limit counters:** the times of your recent translations, linked to your user ID. Only the last 10 minutes count, and older times are dropped the next time you translate or when the bot restarts.
- **Votes and pingbombs** while they're running.

**Logs:** if something fails, the bot logs the type of error. It doesn't log message text, prompts or translations.

The bot keeps nothing else, and there are no backups of the above.

## 6. Privacy of translations

Translations are **ephemeral**: only the person who asked can see them. The author of the original message isn't notified, nothing is posted to the channel, and nothing appears in the server's audit log. Translations of server messages may be cached and reused for anyone translating that exact message. Translations of DMs and of text you type into `/translate` are cached only for you.

## 7. Sharing

The bot shares information only as described above: with **Discord**, which delivers everything, and with **Ollama Cloud**, for `/ai` and Translate. Nothing is sold, rented or used for advertising.

## 8. Children

You must meet [Discord's minimum age](https://discord.com/terms) to use Discord, and therefore this bot.

## 9. Your choices and contact

- **Stop using it:** you can remove the app from your account (User Settings → Authorized Apps), and server admins can remove the bot from their server at any time.
- **Questions, or access or deletion requests:** email **blappay1721@gmail.com** with the subject line **"bruh bot: privacy request"**. Please include your Discord username and what you're asking for. Requests are usually handled within 30 days.

## 10. Changes

If this policy changes, the new version will be posted here with a new effective date. You can see every past version in the repository's history.
