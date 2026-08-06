export type OrderStatus = "new" | "in_progress" | "stalled" | "completed" | "overdue";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "Новый",
  in_progress: "В работе",
  stalled: "Завис",
  completed: "Выполнен",
  overdue: "Просрочен",
};

export const STATUS_COLOR: Record<OrderStatus, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  in_progress: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  stalled: "bg-red-500/15 text-red-300 border-red-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  overdue: "bg-rose-600/20 text-rose-300 border-rose-500/40",
};
