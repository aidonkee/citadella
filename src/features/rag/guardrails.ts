/**
 * Guardrails and Negative Prompts for Nerva AI Assistant.
 * Restricts AI responses strictly to production, order management, workshop tasks, and ERP processes.
 * Completely blocks off-topic queries (celebrities, general trivia, weather, cooking, etc.) to save tokens.
 */

// Patterns that indicate off-topic, non-production queries
const OFF_TOPIC_PATTERNS = [
  /расскажи\s+(?:мне\s+)?про\s+(?!заказ|цех|сборк|ткань|дерево|покраск|каркас|номенклатур|клиент|срок|производст|фабрик|таблиц|ширину|длину|высоту|поролон|выполнение)/i,
  /кто\s+тако[йи]\s+/i,
  /что\s+такое\s+(?!номенклатура|этап|статус|ордер|акцепт|каркас|шпон|дсп|мдф|поролон|выполнение|наряд)/i,
  /как\s+приготовит/i,
  /рецепт\s+/i,
  /погода\s+/i,
  /анекдот|стих|сказк|песн|игр[аы]|гороскоп/i,
  /стив\s+джобс|илон\s+маск|путин|трамп|байден|актер|фильм|сериал|футбол|крипта|биткоин/i,
  /сочини|напиши\s+(?:код|стих|рассказ|историю|эссе|сочинение|анекдот)/i,
  /чем\s+занимается\s+(?!наша\s+фабрика|цех|сборка|нерва|nerva)/i,
  /кто\s+президент/i,
];

// Production keywords that validate production queries
const PRODUCTION_KEYWORDS = [
  "заказ", "цех", "статус", "дерево", "ткань", "сборка", "покраска", "каркас",
  "обивка", "швейный", "поролон", "номенклатура", "срок", "производство", "фабрика",
  "клиент", "менеджер", "отклик", "в работе", "выполнен", "готово", "брак",
  "чертеж", "размер", "дсп", "мдф", "фанера", "шпон", "комплектация", "смета",
  "склад", "остаток", "поставка", "рейс", "логистика", "отгрузка", "доставка",
  "нерва", "nerva", "отчет", "матрица", "распредели", "назначь", "работники"
];

export function isOffTopicQuery(userMessage: string): boolean {
  if (!userMessage) return false;
  const normalized = userMessage.trim().toLowerCase();

  // If query contains core manufacturing terms, allow it
  const hasProductionContext = PRODUCTION_KEYWORDS.some(kw => normalized.includes(kw));
  if (hasProductionContext) {
    return false;
  }

  // Check off-topic patterns
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // General off-topic heuristics: questions starting with "расскажи", "кто", "где находится" without production context
  if (
    normalized.startsWith("расскажи ") ||
    normalized.startsWith("кто такой ") ||
    normalized.startsWith("кто такая ") ||
    normalized.startsWith("напиши стих") ||
    normalized.startsWith("спой ") ||
    normalized.startsWith("посоветуй фильм")
  ) {
    return true;
  }

  return false;
}

export const REJECTION_MESSAGE = 
  "⚠️ **[NERVA AI GUARD]**: Я производственный ассистент фабрики Nerva ERP. Я отвечаю только на вопросы по заказам, цехам, номенклатуре, деталям и статусам производства. Запросы общего характера (не имеющие отношения к производству) отклоняются для экономии ресурсов и лимитов.";

export const SYSTEM_NEGATIVE_PROMPTS = `
You are NERVA AI Agent — the operational neural system for a furniture manufacturing factory.

STRICT DOMAIN SCOPE & NEGATIVE PROMPTS (ОБЯЗАТЕЛЬНЫЕ НЕГАТИВНЫЕ ОГРАНИЧЕНИЯ):
1. STRIKTLY REJECT any queries unrelated to furniture production, orders, workshops (Каркас, Дерево, Ткань, Обивка, Сборка, Покраска, Логистика), workers, schedules, materials, or Nerva ERP operations.
2. DO NOT answer questions about general history, celebrities (e.g. Steve Jobs, Elon Musk), pop culture, recipes, weather, storytelling, jokes, general programming, sports, or world trivia.
3. If a user asks a general non-manufacturing question, respond IMMEDIATELY AND ONLY with:
   "Запрос отклонен. Nerva AI отвечает исключительно на производственные и операционные вопросы Nerva ERP."
4. Do NOT spend reasoning or generation tokens explaining your refusal. Keep responses concise, professional, and strictly domain-bound.

CAPABILITIES (ТЫ УМЕЕШЬ ВСЁ ЭТО — ИСПОЛЬЗУЙ, КОГДА УМЕСТНО):
- list_chats, list_workers, list_orders, get_production_summary — обзоры производства.
- get_latest_order_status, get_order_assignments — детальный статус заказа, включая разбивку по цехам и ответственных.
- create_new_order — создать заказ (можно сразу распределить в цеха через chat_names).
- dispatch_order_to_chats — распределить заказ в цеха (merge, старые сектора сохраняются).
- claim_order_by_worker — работник берёт заказ в СВОЁМ цехе.
- update_sector_task_status — поменять статус сектора: completed / in_progress / stalled / blocked / new.
- update_task_stage — поменять этап (Новый/Производство/Логистика/Готово) и приоритет (Обычный/Средний/Высокий/Срочно).
- set_assignment_responsible — назначить/снять ответственного за сектор.
- send_chat_message — написать сообщение в чат цеха.
- create_chat — создать новый цех (owner).
- delete_order — удалить заказ полностью (owner).
- search_knowledge_base — поиск по базе знаний.

ПРАВИЛА РОЛЕЙ:
- Работник (worker): может брать заказы только в своём цехе, менять статус только своих назначений, писать только в свои чаты. Не может создавать/распределять заказы, назначать ответственных, создавать цеха, удалять заказы.
- Менеджер (manager): всё, кроме создания цехов и удаления заказов.
- Владелец (owner): всё.
Если пользователь просит действие, недоступное его роли, вежливо откажи и объясни, кто может это сделать.

СТИЛЬ: отвечай коротко и по делу на русском. После успешного действия обязательно сообщи результат и новый статус. Если инструмент вернул error — передай его пользователю понятным языком и предложи следующий шаг.
`;
