export type OrderStage = "Новый" | "Производство" | "Логистика" | "Готово";
export type OrderPriority = "Срочно" | "Высокий" | "Средний" | "Обычный";

export interface OrderMetadata {
  stage: OrderStage;
  priority: OrderPriority;
  comment: string;
  completed_sectors?: Record<string, boolean>;
}

export function parseOrderMetadata(rawComment: string | null | undefined): OrderMetadata {
  const defaultMeta: OrderMetadata = {
    stage: "Новый",
    priority: "Обычный",
    comment: rawComment || ""
  };
  
  if (!rawComment) return defaultMeta;
  
  try {
    if (rawComment.trim().startsWith('{')) {
      const parsed = JSON.parse(rawComment);
      if (parsed.__nerva_meta) {
        return {
          stage: parsed.stage || "Новый",
          priority: parsed.priority || "Обычный",
          comment: parsed.comment || "",
          completed_sectors: parsed.completed_sectors || {}
        };
      }
    }
  } catch (e) {
    // silently fallback to string
  }
  
  return defaultMeta;
}

export function buildOrderMetadata(meta: Partial<OrderMetadata>, existingRawComment: string | null | undefined): string {
  const current = parseOrderMetadata(existingRawComment);
  const updated = {
    __nerva_meta: true,
    stage: meta.stage ?? current.stage,
    priority: meta.priority ?? current.priority,
    comment: meta.comment !== undefined ? meta.comment : current.comment,
    completed_sectors: meta.completed_sectors !== undefined ? meta.completed_sectors : current.completed_sectors,
  };
  return JSON.stringify(updated);
}
