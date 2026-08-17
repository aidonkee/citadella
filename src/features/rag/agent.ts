import { genAI, GENERATION_MODEL } from "./client";
import { agentTools, executeToolCall, type ToolContext } from "./tools";
import { isOffTopicQuery, REJECTION_MESSAGE, SYSTEM_NEGATIVE_PROMPTS } from "./guardrails";

export interface AgentContext extends ToolContext {}

export interface AgentResult {
  reply: string;
  affectedOrders: string[];
}

export class RAGAgent {
  private model;
  private context: AgentContext;
  private affectedOrders: Set<string> = new Set();

  constructor(context: AgentContext = {}) {
    this.context = context;
    const roleInstruction = context.userRole
      ? `Текущая роль пользователя: ${context.userRole} (owner — владелец, manager — менеджер, worker — работник цеха).`
      : "";
    this.model = genAI.getGenerativeModel({
      model: GENERATION_MODEL,
      tools: [{ functionDeclarations: agentTools }],
      systemInstruction: `${SYSTEM_NEGATIVE_PROMPTS}\n${roleInstruction}`,
    });
  }

  async run(userMessage: string): Promise<AgentResult> {
    console.log(`User (${this.context.userRole || "guest"}): ${userMessage}`);

    // Pre-filter check: Block non-manufacturing queries locally before spending tokens
    if (isOffTopicQuery(userMessage)) {
      console.log(`[RAGAgent Guardrail] Blocked off-topic query: "${userMessage}"`);
      return { reply: REJECTION_MESSAGE, affectedOrders: [] };
    }

    // Use generateContent directly for better tool call control
    const history: any[] = [{ role: "user", parts: [{ text: userMessage }] }];

    for (let iteration = 0; iteration < 8; iteration++) {
      const result = await this.model.generateContent({ contents: history });
      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const hasFunctionCall = parts.some((p: any) => p.functionCall);

      if (!hasFunctionCall) {
        // Final text response
        const textPart = parts.find((p: any) => p.text);
        return {
          reply: textPart?.text ?? "Нет ответа",
          affectedOrders: Array.from(this.affectedOrders),
        };
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
          const toolResult = await executeToolCall(name, args, {
            ...this.context,
            affectedOrders: this.affectedOrders,
          });
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

    return { reply: "Агент не смог завершить запрос.", affectedOrders: Array.from(this.affectedOrders) };
  }
}