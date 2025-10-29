import express from "express";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.post("/api/summary-gemini", async (req, res) => {
  const { title, authors = [], descriptionHint = "" } = req.body;

  const prompt = `Write a short, neutral, spoiler-free summary (3–5 sentences) of the book "${title}" by ${authors.join(", ") || "an unknown author"}. 
  Focus on the central themes and setup only. Avoid spoilers and opinions. ${descriptionHint ? "Context: " + descriptionHint : ""}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    res.json({ summary: text });
  } catch (err) {
    console.error("Gemini summary error:", err);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

app.listen(8787, () => console.log("✅ Gemini summary API running on http://localhost:8787"));