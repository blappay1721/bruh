# bruhcord Bot

## Project structure
Below is a basic overview of the project structure:

```
├── examples    -> short, feature-specific sample apps
│   ├── app.js  -> finished app.js code
│   ├── button.js
│   ├── command.js
│   ├── modal.js
│   ├── selectMenu.js
├── .env.sample -> sample .env file
├── app.js      -> main entrypoint for app
├── commands.js -> slash command payloads + helpers
├── game.js     -> logic specific to RPS
├── utils.js    -> utility functions and enums
├── package.json
├── README.md
└── .gitignore
```

## Fellow swww...
The bot is currently hosted locally through ngrok. I will work on 24/7 cloud hosting later.
To add a command, follow the structure outlined in the already completed commands in '''app.js''' and '''commands.js'''. Then send me a pull request to give it a look through.