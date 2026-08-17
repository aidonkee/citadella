import * as XLSX from "xlsx-js-style";
import { parseOrderMetadata } from "./order-metadata";

type AssignmentLike = {
  order_id: string;
  chat_id: string;
  status: string;
  responsible_user_id?: string | null;
};

const SECTOR_FILL: Record<string, { rgb: string; font: string; text: string }> = {
  completed:   { rgb: "C6EFCE", font: "006100", text: "✅ Сделано" },
  in_progress: { rgb: "DDEBF7", font: "1F4E79", text: "🔵 В работе" },
  stalled:     { rgb: "FFC7CE", font: "9C0006", text: "⚠️ Проблема" },
  blocked:     { rgb: "FFC7CE", font: "9C0006", text: "⚠️ Заблокирован" },
  overdue:     { rgb: "FFC7CE", font: "9C0006", text: "⏰ Просрочено" },
  new:         { rgb: "FFEB9C", font: "9C6500", text: "🟡 Ожидает" },
  distributed: { rgb: "FFEB9C", font: "9C6500", text: "🟡 Ожидает" },
};

export function exportOrdersToExcel(
  orders: any[],
  profiles: Record<string, string>,
  assignments: AssignmentLike[] = [],
  departmentChats: { id: string; name: string }[] = [],
) {
  // ============================ Лист 1: Заказы ============================
  const data = orders.map(o => {
    const meta = parseOrderMetadata(o.comment);
    const dateObj = o.created_at ? new Date(o.created_at) : new Date();
    const oa = assignments.filter(a => a.order_id === o.id && a.status !== "cancelled");
    const done = oa.filter(a => a.status === "completed").length;
    const responsibles = [...new Set(oa.filter(a => a.responsible_user_id).map(a => profiles[a.responsible_user_id!] ?? "—"))];

    let qty = 1;
    const qtyMatch = o.nomenclature.match(/(?:x|х)\s*(\d+)/i) || o.nomenclature.match(/(\d+)\s*(?:шт|штук)/i);
    if (qtyMatch) {
      qty = parseInt(qtyMatch[1], 10);
    }

    return {
      "Дата": dateObj.toLocaleDateString("ru-RU", { day: '2-digit', month: '2-digit' }),
      "Время": dateObj.toLocaleTimeString("ru-RU", { hour: '2-digit', minute: '2-digit' }),
      "Номер заказа": o.number,
      "Номенклатура": o.nomenclature,
      "Кол-во": qty,
      "Заказ покупателя": o.customer_order || "",
      "Комментарий": meta.comment || "",
      "Ответственные": responsibles.join(", ") || "Не назначены",
      "Прогресс": oa.length ? `${done} / ${oa.length} секторов` : "не распределён",
      "Этап": o.stage || meta.stage,
      "Приоритет": o.priority || meta.priority,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  styleSheet(worksheet, data);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Заказы");

  // ============================ Лист 2: Матрица цехов ============================
  if (departmentChats.length > 0) {
    const header = ["Производство", "Номенклатура", "Дата", "Финиш", "Заказ покупателя", "Общий статус", ...departmentChats.map(c => c.name)];
    const matrixRows: any[][] = [header];

    for (const o of orders) {
      const meta = parseOrderMetadata(o.comment);
      const row: any[] = [
        o.number,
        o.nomenclature,
        o.order_date ?? (o.created_at ? new Date(o.created_at).toLocaleDateString("ru-RU") : ""),
        o.finish_date ?? "",
        o.customer_order ?? "",
        statusText(o.status),
      ];
      for (const c of departmentChats) {
        const a = assignments.find(x => x.order_id === o.id && x.chat_id === c.id);
        if (!a || a.status === "cancelled") {
          row.push("");
        } else {
          const who = a.responsible_user_id ? (profiles[a.responsible_user_id] ?? "") : "";
          row.push(`${SECTOR_FILL[a.status]?.text ?? a.status}${who ? `\n${who}` : ""}`);
        }
      }
      matrixRows.push(row);
    }

    const matrixSheet = XLSX.utils.aoa_to_sheet(matrixRows);

    // Ширина колонок
    matrixSheet["!cols"] = header.map((h, i) => ({ wch: i === 1 ? 34 : i < 6 ? 14 : 16 }));

    // Стили заголовка
    for (let C = 0; C < header.length; ++C) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!matrixSheet[addr]) continue;
      matrixSheet[addr].s = {
        fill: { fgColor: { rgb: "333333" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
      };
    }

    // Цветные ячейки секторов
    for (let R = 1; R < matrixRows.length; ++R) {
      const o = orders[R - 1];
      for (let C = 6; C < header.length; ++C) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!matrixSheet[addr]) continue;
        const chat = departmentChats[C - 6];
        const a = assignments.find(x => x.order_id === o.id && x.chat_id === chat.id);
        const style = a && a.status !== "cancelled" ? SECTOR_FILL[a.status] : null;
        matrixSheet[addr].s = {
          ...(style ? { fill: { fgColor: { rgb: style.rgb } }, font: { color: { rgb: style.font }, bold: true } } : {}),
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: thinBorder(),
        };
      }
      // Базовые границы для информационных колонок
      for (let C = 0; C < 6; ++C) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!matrixSheet[addr]) continue;
        matrixSheet[addr].s = { border: thinBorder(), alignment: { vertical: "center", wrapText: true } };
      }
    }

    XLSX.utils.book_append_sheet(workbook, matrixSheet, "Матрица цехов");
  }

  const todayStr = new Date().toLocaleDateString("ru-RU").replace(/\./g, "-");
  const fileName = `Заказы_Мебельное_Производство_${todayStr}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}

function statusText(status: string): string {
  switch (status) {
    case "completed": return "✅ Выполнен";
    case "in_progress": return "🔵 В работе";
    case "stalled": return "⚠️ Завис";
    case "overdue": return "⏰ Просрочен";
    case "distributed": return "🟣 Распределён";
    case "cancelled": return "🚫 Отменён";
    default: return "🆕 Новый";
  }
}

function thinBorder() {
  return {
    top: { style: "thin", color: { rgb: "DDDDDD" } },
    bottom: { style: "thin", color: { rgb: "DDDDDD" } },
    left: { style: "thin", color: { rgb: "DDDDDD" } },
    right: { style: "thin", color: { rgb: "DDDDDD" } },
  } as any;
}

function styleSheet(worksheet: XLSX.WorkSheet, data: any[]) {
  // Auto-width logic
  const colWidths = Object.keys(data[0] || {}).map(key => {
    const maxDataLength = Math.max(...data.map(row => String((row as any)[key] || "").length));
    return { wch: Math.max(key.length + 2, Math.min(maxDataLength + 2, 60)) };
  });
  worksheet["!cols"] = colWidths;

  const range = XLSX.utils.decode_range(worksheet["!ref"]!);
  // Header Styling (Dark background, white text)
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const address = XLSX.utils.encode_cell({ r: 0, c: C });
    if (!worksheet[address]) continue;
    worksheet[address].s = {
      fill: { fgColor: { rgb: "333333" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
      alignment: { horizontal: "center", vertical: "center" }
    };
  }

  // Data Styling (Borders, Alignment)
  for (let R = 1; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ r: R, c: C });
      if (!worksheet[address]) continue;
      worksheet[address].s = {
        border: thinBorder(),
        alignment: { vertical: "center", wrapText: true }
      };
    }
  }
}
