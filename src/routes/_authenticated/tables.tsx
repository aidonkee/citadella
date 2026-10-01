import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Filter, ArrowUpDown, Calculator, Save, Table as TableIcon, X, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tables")({
  head: () => ({ meta: [{ title: "Таблицы Nerva (Airtable / Excel CRM)" }] }),
  component: TablesEditor,
});

type ColumnType = "text" | "number" | "date" | "status" | "formula";

interface Column {
  id: string;
  name: string;
  type: ColumnType;
  formula?: string; // e.g. "col_1 + col_2" or "SUM(col_1)"
}

interface RowData {
  id: string;
  [columnId: string]: any;
}

export function TablesEditor() {
  const [columns, setColumns] = useState<Column[]>([
    { id: "col_name", name: "Наименование", type: "text" },
    { id: "col_qty", name: "Количество", type: "number" },
    { id: "col_price", name: "Цена за ед. (₽)", type: "number" },
    { id: "col_status", name: "Статус", type: "status" },
    { id: "col_total", name: "Сумма (Формула)", type: "formula", formula: "col_qty * col_price" },
  ]);

  const [rows, setRows] = useState<RowData[]>([
    { id: "row_1", col_name: "Рама металлическая №101", col_qty: 12, col_price: 15000, col_status: "В работе" },
    { id: "row_2", col_name: "Крепежный комплект М12", col_qty: 250, col_price: 180, col_status: "Готово" },
    { id: "row_3", col_name: "Профиль алюминиевый 4м", col_qty: 45, col_price: 3200, col_status: "На складе" },
  ]);

  const [filterQuery, setFilterQuery] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<ColumnType>("text");
  const [newColFormula, setNewColFormula] = useState("");
  const [saving, setSaving] = useState(false);

  // Загрузка из Supabase при старте
  useEffect(() => {
    async function loadFromDb() {
      const { data: tblData } = await (supabase.from("custom_tables" as any) as any).select("*").eq("name", "Основная таблица CRM").maybeSingle();
      if (tblData && tblData.columns) {
        setColumns(tblData.columns as Column[]);
        const { data: rowData } = await (supabase.from("custom_table_rows" as any) as any).select("*").eq("table_id", tblData.id);
        if (rowData && rowData.length > 0) {
          setRows(rowData.map((r: any) => ({ id: r.id, ...r.data })));
        }
      } else {
        // Попытка загрузить из localStorage если SQL-таблицы еще не созданы
        const savedCols = localStorage.getItem("nerva_table_cols");
        const savedRows = localStorage.getItem("nerva_table_rows");
        if (savedCols) try { setColumns(JSON.parse(savedCols)); } catch {}
        if (savedRows) try { setRows(JSON.parse(savedRows)); } catch {}
      }
    }
    loadFromDb();
  }, []);

  // Сохранение в Supabase / localStorage
  const handleSave = async () => {
    setSaving(true);
    localStorage.setItem("nerva_table_cols", JSON.stringify(columns));
    localStorage.setItem("nerva_table_rows", JSON.stringify(rows));

    try {
      let { data: tbl } = await (supabase.from("custom_tables" as any) as any).select("id").eq("name", "Основная таблица CRM").maybeSingle();
      if (!tbl) {
        const { data: created, error } = await (supabase.from("custom_tables" as any) as any).insert({ name: "Основная таблица CRM", columns }).select("id").maybeSingle();
        if (error) throw error;
        tbl = created;
      } else {
        await (supabase.from("custom_tables" as any) as any).update({ columns }).eq("id", tbl.id);
      }

      if (tbl?.id) {
        // Очищаем старые строки и вставляем новые
        await (supabase.from("custom_table_rows" as any) as any).delete().eq("table_id", tbl.id);
        const toInsert = rows.map(r => {
          const { id, ...data } = r;
          return { id: id.startsWith("row_") ? undefined : id, table_id: tbl.id, data };
        });
        await (supabase.from("custom_table_rows" as any) as any).insert(toInsert);
      }
      toast.success("Таблица успешно сохранена в БД");
    } catch (err: any) {
      toast.error(`БД недоступна — данные сохранены только локально (${err.message ?? "ошибка"})`);
    } finally {
      setSaving(false);
    }
  };

  // Вычисление значения ячейки (для формул)
  const getCellValue = (row: RowData, col: Column) => {
    if (col.type !== "formula" || !col.formula) return row[col.id];
    try {
      // Простая обработка формул умножения / сложения / вычитания колонок
      let expr = col.formula;
      for (const c of columns) {
        if (c.type === "number") {
          const val = Number(row[c.id]) || 0;
          expr = expr.replaceAll(c.id, String(val));
        }
      }
      // Безопасное вычисление базового математического выражения
      if (/^[0-9+\-*/().\s]+$/.test(expr)) {
        return Function(`'use strict'; return (${expr})`)();
      }
      return "ОШИБКА";
    } catch {
      return "#ЗНАЧ!";
    }
  };

  // Отфильтрованные и отсортированные строки
  const processedRows = useMemo(() => {
    let result = [...rows];
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter(r => 
        columns.some(c => String(getCellValue(r, c) ?? "").toLowerCase().includes(q))
      );
    }
    if (sortCol) {
      const col = columns.find(c => c.id === sortCol);
      if (col) {
        result.sort((a, b) => {
          const valA = getCellValue(a, col) ?? "";
          const valB = getCellValue(b, col) ?? "";
          if (col.type === "number" || col.type === "formula") {
            return sortAsc ? (Number(valA) - Number(valB)) : (Number(valB) - Number(valA));
          }
          return sortAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
        });
      }
    }
    return result;
  }, [rows, columns, filterQuery, sortCol, sortAsc]);

  // Добавление новой колонки
  const addColumn = () => {
    if (!newColName.trim()) return;
    const id = "col_" + Date.now();
    setColumns([...columns, { id, name: newColName.trim(), type: newColType, formula: newColType === "formula" ? newColFormula : undefined }]);
    setNewColName("");
    setNewColFormula("");
    toast.success(`Колонка «${newColName}» добавлена`);
  };

  // Добавление новой строки
  const addRow = () => {
    const newRow: RowData = { id: "row_" + Date.now() };
    for (const c of columns) {
      if (c.type === "number") newRow[c.id] = 0;
      else if (c.type === "status") newRow[c.id] = "Новый";
      else newRow[c.id] = "";
    }
    setRows([...rows, newRow]);
  };

  // Изменение значения ячейки
  const updateCell = (rowId: string, colId: string, val: any) => {
    setRows(rows.map(r => r.id === rowId ? { ...r, [colId]: val } : r));
  };

  // Удаление строки
  const deleteRow = (rowId: string) => {
    setRows(rows.filter(r => r.id !== rowId));
  };

  // Удаление колонки
  const deleteColumn = (colId: string) => {
    setColumns(columns.filter(c => c.id !== colId));
  };

  const cellInput = "h-8 text-sm bg-transparent border-transparent focus:border-ring focus:bg-background px-2 rounded-md";
  const statusSelect = "h-8 text-sm bg-background border-border rounded-md";

  return (
    <div className="soft-scrollbar h-full overflow-y-auto bg-background p-4 sm:p-6 space-y-4 pb-24 md:pb-6">
      {/* Заголовок и панель управления */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2.5">
            <TableIcon className="size-5 text-primary" />
            Таблицы
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ведение учёта, расчётные формулы, фильтрация и сортировка данных
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 w-full sm:w-auto">
          <Button onClick={addRow} className="h-10">
            <Plus className="size-4" />
            Строка
          </Button>
          <Button onClick={handleSave} disabled={saving} variant="outline" className="h-10">
            <Save className="size-4" />
            {saving ? "Сохранение..." : "Сохранить в БД"}
          </Button>
        </div>
      </div>

      {/* Панель фильтров и создания колонок */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              placeholder="Поиск по всем ячейкам..."
              className="pl-9 h-10"
            />
          </div>
          {filterQuery && (
            <Button variant="ghost" size="icon" onClick={() => setFilterQuery("")} className="h-10 w-10 shrink-0" aria-label="Очистить поиск">
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted-foreground font-medium mr-1">Новая колонка:</span>
          <Input
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="Название"
            className="h-10 w-36"
            onKeyDown={(e) => e.key === "Enter" && addColumn()}
          />
          <Select value={newColType} onValueChange={(v: any) => setNewColType(v)}>
            <SelectTrigger className="h-10 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Текст</SelectItem>
              <SelectItem value="number">Число</SelectItem>
              <SelectItem value="date">Дата</SelectItem>
              <SelectItem value="status">Статус</SelectItem>
              <SelectItem value="formula">Формула</SelectItem>
            </SelectContent>
          </Select>
          {newColType === "formula" && (
            <Input
              value={newColFormula}
              onChange={e => setNewColFormula(e.target.value)}
              placeholder="col_qty * col_price"
              className="h-10 w-44 font-mono text-sm"
            />
          )}
          <Button onClick={addColumn} variant="secondary" className="h-10">
            <Plus className="size-4" />
            Добавить
          </Button>
        </div>
      </div>

      {/* Мобильный список карточек (< 640px) */}
      <div className="block sm:hidden space-y-3">
        {processedRows.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm border border-dashed border-border rounded-xl bg-card">
            Нет данных
          </div>
        ) : (
          processedRows.map((row, idx) => (
            <div key={row.id} className="border border-border bg-card rounded-xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-sm">Строка #{idx + 1}</span>
                <Button variant="ghost" size="icon" onClick={() => deleteRow(row.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="space-y-2.5">
                {columns.map(col => {
                  const val = getCellValue(row, col);
                  return (
                    <div key={col.id} className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                        {col.name} {col.type !== "text" && <span className="text-muted-foreground/60 normal-case">({col.type})</span>}
                      </span>
                      {col.type === "formula" ? (
                        <div className="px-3 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                          {typeof val === "number" ? val.toLocaleString() : val}
                        </div>
                      ) : col.type === "status" ? (
                        <Select value={row[col.id] || "Новый"} onValueChange={v => updateCell(row.id, col.id, v)}>
                          <SelectTrigger className="h-10 text-sm bg-background border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Новый">Новый</SelectItem>
                            <SelectItem value="В работе">В работе</SelectItem>
                            <SelectItem value="На складе">На складе</SelectItem>
                            <SelectItem value="Готово">Готово</SelectItem>
                            <SelectItem value="Задерживается">Задерживается</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                          value={row[col.id] ?? ""}
                          onChange={e => updateCell(row.id, col.id, col.type === "number" ? Number(e.target.value) : e.target.value)}
                          className="h-10 text-sm bg-background border-border"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Основной десктопный грид таблицы (>= 640px) */}
      <div className="hidden sm:block overflow-auto rounded-xl border border-border bg-card soft-scrollbar">
        <Table>
          <TableHeader className="bg-muted/60 sticky top-0 z-20">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center border-r border-border text-xs font-semibold uppercase text-muted-foreground">#</TableHead>
              {columns.map(col => (
                <TableHead key={col.id} className="border-r border-border p-2 text-xs font-semibold uppercase text-foreground min-w-[140px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex items-center gap-1.5">
                      {col.type === "formula" && <Calculator className="size-3.5 text-primary shrink-0" />}
                      {col.name}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          if (sortCol === col.id) setSortAsc(!sortAsc);
                          else { setSortCol(col.id); setSortAsc(true); }
                        }}
                        className={`p-1.5 rounded hover:bg-muted transition-colors ${sortCol === col.id ? "text-primary" : "text-muted-foreground"}`}
                        title="Сортировать"
                      >
                        <ArrowUpDown className="size-3.5" />
                      </button>
                      <button
                        onClick={() => deleteColumn(col.id)}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Удалить колонку"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  {col.type === "formula" && col.formula && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{col.formula}</div>
                  )}
                </TableHead>
              ))}
              <TableHead className="w-14 text-center text-xs font-semibold uppercase text-muted-foreground">Действие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processedRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length + 2} className="h-32 text-center text-muted-foreground text-sm">
                  Нет данных или не найдено по фильтру
                </TableCell>
              </TableRow>
            ) : (
              processedRows.map((row, idx) => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="text-center text-muted-foreground text-xs border-r border-border">{idx + 1}</TableCell>
                  {columns.map(col => {
                    const val = getCellValue(row, col);
                    return (
                      <TableCell key={col.id} className="border-r border-border p-1.5 text-sm">
                        {col.type === "formula" ? (
                          <div className="px-2.5 py-1.5 font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md">
                            {typeof val === "number" ? val.toLocaleString() : val}
                          </div>
                        ) : col.type === "status" ? (
                          <Select value={row[col.id] || "Новый"} onValueChange={v => updateCell(row.id, col.id, v)}>
                            <SelectTrigger className={statusSelect}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Новый">Новый</SelectItem>
                              <SelectItem value="В работе">В работе</SelectItem>
                              <SelectItem value="На складе">На складе</SelectItem>
                              <SelectItem value="Готово">Готово</SelectItem>
                              <SelectItem value="Задерживается">Задерживается</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                            value={row[col.id] ?? ""}
                            onChange={e => updateCell(row.id, col.id, col.type === "number" ? Number(e.target.value) : e.target.value)}
                            className={cellInput}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center p-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteRow(row.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Удалить строку"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Подвал: автоматический расчет сумм и средних значений */}
      <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Всего строк:</span>
          <strong className="text-foreground font-semibold">{processedRows.length}</strong>
        </div>
        {columns.filter(c => c.type === "number" || c.type === "formula").slice(0, 3).map(col => {
          let sum = 0;
          let validCount = 0;
          for (const r of processedRows) {
            const v = Number(getCellValue(r, col));
            if (!isNaN(v)) {
              sum += v;
              validCount++;
            }
          }
          const avg = validCount > 0 ? (sum / validCount).toFixed(1) : 0;
          return (
            <div key={col.id} className="flex flex-col">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">{col.name} — сумма</div>
              <div className="font-semibold text-foreground flex items-center gap-2">
                <span>{sum.toLocaleString()}</span>
                <span className="text-[11px] text-muted-foreground font-normal">(средн: {avg})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
