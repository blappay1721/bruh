import fetch from "node-fetch";

export async function getAIResponse(prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/blappay1721/bruh", // ← Replace with your site or GitHub repo
      "X-Title": "bruh",                    // ← A short name for your project
    },
    body: JSON.stringify({
      model: "tngtech/deepseek-r1t2-chimera:free", // ← You can change this to another model if you want
      messages: [
        { role: "system", content: "You are a helpful Discord bot named bruh. Always answer in < 1900 characters." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("❌ OpenRouter API error:", data);
    throw new Error(data?.error?.message || "Unknown error from OpenRouter");
  }

  return data.choices?.[0]?.message?.content || "⚠️ No content returned.";
}

