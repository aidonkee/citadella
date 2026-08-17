import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set in the environment variables.");
}

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const GENERATION_MODEL = "gemini-3.6-flash";
