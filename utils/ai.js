import fetch from "node-fetch";

export async function getAIResponse(prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistralai/mistral-7b-instruct", // Free/cheap, feel free to change
      messages: [
        { role: "system", content: "You are a helpful and informal assistant named bruh." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("OpenRouter error:", data);
    throw new Error(data?.error?.message || "Unknown OpenRouter error");
  }

  return data?.choices?.[0]?.message?.content || "⚠️ No response generated.";
}

