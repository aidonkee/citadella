import { addDocumentToVectorStore } from "./vector-store";

export async function syncKnowledgeBase() {
  const documents = [
    {
      content: "Заказ НФОС-00096 находится в зоне ответственности менеджера Рината. Он отвечает за его комплектацию.",
      metadata: { source: "manual_entry", type: "responsibility" }
    },
    {
      content: "При задержке заказа более чем на 3 дня, необходимо уведомить начальника цеха и перевести статус в 'stalled'.",
      metadata: { source: "regulation", type: "process" }
    },
  ];

  console.log("Starting knowledge base sync...");
  for (const doc of documents) {
    await addDocumentToVectorStore(doc.content, doc.metadata);
    console.log(`Synced document: ${doc.content.substring(0, 30)}...`);
  }
  console.log("Sync completed!");
}
