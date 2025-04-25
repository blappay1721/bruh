import { spawn } from "child_process";

function startBot() {
  const bot = spawn("node", ["app.js"], { stdio: "inherit" });

  bot.on("exit", (code) => {
    console.error(`Bot crashed with code ${code}. Restarting...`);
    setTimeout(startBot, 3000); // Wait 3 seconds, then restart
  });
}

startBot();
