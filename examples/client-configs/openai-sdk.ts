import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.ROUTER_BASE_URL ?? "http://127.0.0.1:8787/v1",
  apiKey: process.env.ROUTER_API_KEY ?? "local-router-key"
});

const response = await client.chat.completions.create({
  model: "auto-coding",
  messages: [
    {
      role: "user",
      content: "Write a small TypeScript debounce function."
    }
  ]
});

console.log(response.choices[0]?.message?.content);
