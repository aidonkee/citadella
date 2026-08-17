import { genAI, GENERATION_MODEL } from "./client";
import { agentTools, executeToolCall } from "./tools";
import { isOffTopicQuery, REJECTION_MESSAGE, SYSTEM_NEGATIVE_PROMPTS } from "./guardrails";

export interface AgentContext {
  userId?: string;
  userRole?: string;
}

export class RAGAgent {
  private model;
  private context: AgentContext;

  constructor(context: AgentContext = {}) {
    this.context = context;
    const roleInstruction = context.userRole 
      ? `Текущая роль пользователя: ${context.userRole}.`
      : "";
    this.model = genAI.getGenerativeModel({
      model: GENERATION_MODEL,
      tools: [{ functionDeclarations: agentTools }],
      systemInstruction: `${SYSTEM_NEGATIVE_PROMPTS}\n${roleInstruction}`,
    });
  }

  async run(userMessage: string): Promise<string> {
    console.log(`User (${this.context.userRole || "guest"}): ${userMessage}`);

    // Pre-filter check: Block non-manufacturing queries locally before spending tokens
    if (isOffTopicQuery(userMessage)) {
      console.log(`[RAGAgent Guardrail] Blocked off-topic query: "${userMessage}"`);
      return REJECTION_MESSAGE;
    }

    // Use generateContent directly for better tool call control
    const history: any[] = [{ role: "user", parts: [{ text: userMessage }] }];

    for (let iteration = 0; iteration < 5; iteration++) {
      const result = await this.model.generateContent({ contents: history });
      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const hasFunctionCall = parts.some((p: any) => p.functionCall);

      if (!hasFunctionCall) {
        // Final text response
        const textPart = parts.find((p: any) => p.text);
        return textPart?.text ?? "Нет ответа";
      }

      // Add model response to history
      history.push({ role: "model", parts });

      // Execute all function calls and collect results
      const functionResultParts: any[] = [];
      for (const part of parts) {
        if (!part.functionCall) continue;
        const { name, args } = part.functionCall;
        console.log(`[Agent Tool Call] ${name}(${JSON.stringify(args)}) for role ${this.context.userRole}`);

        try {
          const toolResult = await executeToolCall(name, args, this.context);
          // API requires response to be a plain object, not an array
          const safeResult = Array.isArray(toolResult)
            ? { items: toolResult }
            : (toolResult && typeof toolResult === "object" ? toolResult : { value: toolResult ?? null });
          functionResultParts.push({
            functionResponse: { name, response: safeResult },
          });
        } catch (error) {
          console.error(`Tool execution failed:`, error);
          functionResultParts.push({
            functionResponse: {
              name,
              response: { error: error instanceof Error ? error.message : "Unknown error" },
            },
          });
        }
      }

      // Add tool results to history as "user" role (required by this API version)
      history.push({ role: "user", parts: functionResultParts });
    }

    return "Агент не смог завершить запрос.";
  }
}
