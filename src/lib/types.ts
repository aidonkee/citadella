export type OrderStatus =
  | "new"          // заказ создан, не распределён (Order) / ожидает принятия (Assignment)
  | "distributed"  // заказ распределён по секторам, все ожидают принятия (Order)
  | "in_progress"  // в работе
  | "stalled"      // проблема / завис
  | "blocked"      // заблокирован (assignment-level)
  | "completed"    // выполнен
  | "overdue"      // просрочен
  | "cancelled";   // отменён

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Новый",
  distributed: "Распределён",
  in_progress: "В работе",
  stalled: "Завис",
  blocked: "Заблокирован",
  completed: "Выполнен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

export const STATUS_COLOR: Record<OrderStatus, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  distributed: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  stalled: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  overdue: "bg-rose-600/20 text-rose-700 dark:text-rose-300 border-rose-500/40",
  cancelled: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
};

// Метки статуса на уровне assignment (для чатов и матрицы)
export const ASSIGNMENT_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Ожидает принятия",
  distributed: "Ожидает принятия",
  in_progress: "В работе",
  stalled: "Завис",
  blocked: "Заблокирован",
  completed: "Выполнено",
  overdue: "Просрочено",
  cancelled: "Отменено",
};
