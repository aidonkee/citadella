import "dotenv/config";
import { RAGAgent } from "./agent";
import { syncKnowledgeBase } from "./sync-engine";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "sync") {
    await syncKnowledgeBase();
    process.exit(0);
  }

  const query = command || "Кто отвечает за заказ НФОС-00096?";
  
  console.log(`Testing Agent with query: "${query}"`);
  const agent = new RAGAgent();
  const response = await agent.run(query);
  
  console.log(`\nAgent Response:\n${response}`);
  process.exit(0);
}

main().catch(console.error);
