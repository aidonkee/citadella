import { genAI, EMBEDDING_MODEL } from "./client";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Create a Supabase client directly using process.env (Node.js compatible, no import.meta.env)
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://nngbqrfatvpxwxoljihv.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  return createClient(url, key, { realtime: { transport: ws as any } });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const response = await model.embedContent({
      content: { role: "user", parts: [{ text }] },
      // Reduce output to 768 dims — compatible with pgvector HNSW index (max 2000)
      outputDimensionality: 768,
    } as any);
    return response.embedding.values || [];
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

export async function addDocumentToVectorStore(content: string, metadata: any = {}) {
  const embedding = await generateEmbedding(content);

  if (!embedding || embedding.length === 0) {
    throw new Error("Failed to generate embedding for the document.");
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("knowledge_base")
    .insert({ content, embedding, metadata });

  if (error) {
    console.error("Error inserting document into vector store:", error);
    throw error;
  }
}

export async function searchVectorStore(query: string, matchCount: number = 3) {
  const queryEmbedding = await generateEmbedding(query);

  if (!queryEmbedding || queryEmbedding.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("match_knowledge", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });

  if (error) {
    console.error("Error searching vector store:", error);
    throw error;
  }

  return data;
}
