import fetch from "node-fetch";

export async function getAIResponse(prompt) {
  const res = await fetch("https://cloud.ollama.com/api/chat", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OLLAMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v3.1:671b-cloud", // your cloud model
      messages: [
        { role: "system", content: "You are a helpful Discord bot named bruh. Always answer in < 1900 characters." },
        { role: "user", content: prompt },
      ],
      stream: false, // set true if you want streaming later
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("❌ Ollama Cloud API error:", data);
    throw new Error(data?.error?.message || "Unknown error from Ollama Cloud");
  }

  // Ollama returns messages in a similar structure
  return (
    data.message?.content ||
    data.messages?.[0]?.content ||
    "  No content returned."
  );
}

