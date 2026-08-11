import * as XLSX from "xlsx-js-style";
import { parseOrderMetadata } from "./order-metadata";

export function exportOrdersToExcel(orders: any[], profiles: Record<string, string>) {
  const data = orders.map(o => {
    const meta = parseOrderMetadata(o.comment);
    const dateObj = o.created_at ? new Date(o.created_at) : new Date();
    
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
      "Комментарий": meta.comment || o.comment || "",
      "Ответственный": o.responsible_user_id ? profiles[o.responsible_user_id] ?? "Не назначен" : "Не назначен",
      "Этап": o.stage || meta.stage,
      "Приоритет": o.priority || meta.priority,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);

  // Auto-width logic
  const colWidths = Object.keys(data[0] || {}).map(key => {
    const maxDataLength = Math.max(...data.map(row => String((row as any)[key] || "").length));
    return { wch: Math.max(key.length + 2, maxDataLength + 2) };
  });
  worksheet["!cols"] = colWidths;

  // Header Styling (Dark background, white text)
  const range = XLSX.utils.decode_range(worksheet["!ref"]!);
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
        border: {
          top: { style: "thin", color: { rgb: "DDDDDD" } },
          bottom: { style: "thin", color: { rgb: "DDDDDD" } },
          left: { style: "thin", color: { rgb: "DDDDDD" } },
          right: { style: "thin", color: { rgb: "DDDDDD" } },
        },
        alignment: { vertical: "center", wrapText: true }
      };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Заказы");

  const todayStr = new Date().toLocaleDateString("ru-RU").replace(/\./g, "-");
  const fileName = `Заказы_Мебельное_Производство_${todayStr}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}
