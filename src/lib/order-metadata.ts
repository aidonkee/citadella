export type OrderStage = "Новый" | "Производство" | "Логистика" | "Готово";
export type OrderPriority = "Срочно" | "Высокий" | "Средний" | "Обычный";

export interface OrderMetadata {
  stage: OrderStage;
  priority: OrderPriority;
  comment: string;
  completed_sectors?: Record<string, boolean>;
}

export function stripRawJsonMetadata(text: string | null | undefined): string {
  if (!text) return "";
  let s = String(text);
  // Strip any json block containing __nerva_meta (including multi-line and nested braces)
  s = s.replace(/\{[\s\S]*?"__nerva_meta"[\s\S]*?\}\}/g, "");
  s = s.replace(/\{[\s\S]*?"__nerva_meta"[\s\S]*?\}/g, "");
  // Strip any orphaned "Комментарий:\n" or "Комментарий: —" lines left empty
  s = s.replace(/Комментарий:\s*(\n|—|$)/gi, "");
  // Clean up extra blank lines
  s = s.replace(/\n\s*\n\s*\n/g, "\n\n");
  return s.trim();
}

export function parseOrderMetadata(orderOrComment: any): OrderMetadata {
  let stage: OrderStage = "Новый";
  let priority: OrderPriority = "Обычный";
  let comment = "";
  let completed_sectors: Record<string, boolean> = {};

  if (orderOrComment && typeof orderOrComment === "object") {
    if (orderOrComment.stage) stage = orderOrComment.stage as OrderStage;
    if (orderOrComment.priority) priority = orderOrComment.priority as OrderPriority;
    const rawComment = orderOrComment.comment;
    if (rawComment) {
      if (typeof rawComment === "string" && rawComment.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(rawComment);
          if (parsed.__nerva_meta) {
            if (parsed.stage) stage = parsed.stage;
            if (parsed.priority) priority = parsed.priority;
            comment = parsed.comment || "";
            completed_sectors = parsed.completed_sectors || {};
          } else {
            comment = rawComment;
          }
        } catch {
          comment = rawComment;
        }
      } else {
        comment = String(rawComment);
      }
    }
  } else if (typeof orderOrComment === "string") {
    if (orderOrComment.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(orderOrComment);
        if (parsed.__nerva_meta) {
          stage = parsed.stage || "Новый";
          priority = parsed.priority || "Обычный";
          comment = parsed.comment || "";
          completed_sectors = parsed.completed_sectors || {};
        } else {
          comment = orderOrComment;
        }
      } catch {
        comment = orderOrComment;
      }
    } else {
      comment = orderOrComment;
    }
  }

  // Ensure comment is strictly human-readable and free of JSON metadata
  comment = stripRawJsonMetadata(comment);

  return { stage, priority, comment, completed_sectors };
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
