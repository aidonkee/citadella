import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Filter, ArrowUpDown, Calculator, Save, Table as TableIcon, X } from "lucide-react";
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
      toast.success("[NERVA // SYS]: Структура и строки таблицы успешно сохранены в БД!");
    } catch (err: any) {
      toast.error(`[NERVA // LOCAL]: БД недоступна — данные сохранены только локально (${err.message ?? "ошибка"})`);
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
    toast.success(`[NERVA]: Колонка «${newColName}» добавлена`);
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

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 space-y-4 font-mono select-none overflow-hidden bg-transparent">
      {/* Заголовок и панель управления */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-primary/30 pb-4 shrink-0">
        <div>
          <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2.5 text-foreground">
            <TableIcon className="size-6 text-primary" />
            [ РЕДАКТОР ТАБЛИЦ NERVA // CRM ]
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Ведение учёта, расчётные формулы, мгновенная фильтрация и мульти-сортировка данных
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 w-full sm:w-auto">
          <Button onClick={addRow} className="rounded-none bg-primary text-primary-foreground font-mono font-bold uppercase tracking-wider h-10 px-4 shadow-none w-full sm:w-auto">
            <Plus className="size-4 mr-2" />[ + СТРОКА ]
          </Button>
          <Button onClick={handleSave} disabled={saving} variant="outline" className="rounded-none border-primary/50 text-primary font-mono font-bold uppercase tracking-wider h-10 px-4 hover:bg-primary/10 w-full sm:w-auto">
            <Save className="size-4 mr-2" />[ {saving ? "СОХРАНЕНИЕ..." : "СОХРАНИТЬ В БД"} ]
          </Button>
        </div>
      </div>

      {/* Панель фильтров и создания колонок */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 border border-primary/25 bg-card/90 p-3 shrink-0">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-primary shrink-0" />
          <Input
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder="МГНОВЕННЫЙ ФИЛЬТР ПО ВСЕМ ЯЧЕЙКАМ..."
            className="rounded-none h-9 text-xs font-mono bg-background border-border"
          />
          {filterQuery && <Button variant="ghost" size="sm" onClick={() => setFilterQuery("")} className="rounded-none px-2 h-9 text-xs">[ X ]</Button>}
        </div>

        <div className="lg:col-span-2 flex flex-wrap items-center gap-2 justify-end">
          <span className="text-xs text-primary font-bold uppercase tracking-wider mr-1">[ НОВАЯ КОЛОНКА ]:</span>
          <Input
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="НАЗВАНИЕ..."
            className="rounded-none h-9 text-xs font-mono bg-background border-border w-36"
          />
          <Select value={newColType} onValueChange={(v: any) => setNewColType(v)}>
            <SelectTrigger className="rounded-none h-9 text-xs font-mono bg-background border-border w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none font-mono">
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
              className="rounded-none h-9 text-xs font-mono bg-background border-border w-40 text-primary font-bold"
            />
          )}
          <Button onClick={addColumn} variant="secondary" className="rounded-none h-9 px-3 text-xs font-mono font-bold uppercase">
            [ + КОЛОНКА ]
          </Button>
        </div>
      </div>

      {/* Мобильный список карточек (< 640px) */}
      <div className="block sm:hidden flex-1 overflow-y-auto space-y-3 p-1 font-mono">
        {processedRows.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-xs">[ НЕТ ДАННЫХ ]</div>
        ) : (
          processedRows.map((row, idx) => (
            <div key={row.id} className="border border-primary/30 bg-card p-3 space-y-2 text-xs shadow-sm">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="font-bold text-primary text-xs">СТРОКА #{idx + 1}</span>
                <Button variant="ghost" size="sm" onClick={() => deleteRow(row.id)} className="h-6 px-1 text-destructive hover:bg-destructive/20">
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <div className="space-y-2 pt-1">
                {columns.map(col => {
                  const val = getCellValue(row, col);
                  return (
                    <div key={col.id} className="flex flex-col gap-1 border-b border-border/20 pb-1.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">{col.name} ({col.type}):</span>
                      {col.type === "formula" ? (
                        <div className="px-2 py-1 font-bold text-primary bg-primary/10 border border-primary/20">
                          {typeof val === "number" ? val.toLocaleString() : val}
                        </div>
                      ) : col.type === "status" ? (
                        <Select value={row[col.id] || "Новый"} onValueChange={v => updateCell(row.id, col.id, v)}>
                          <SelectTrigger className="rounded-none h-8 text-xs font-mono bg-background border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none font-mono">
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
                          className="rounded-none h-8 text-xs font-mono bg-background border-border"
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
      <div className="hidden sm:block flex-1 overflow-auto border border-primary/30 bg-card/95 relative soft-scrollbar">
        <Table className="w-full border-collapse">
          <TableHeader className="bg-background/90 sticky top-0 z-20 border-b border-primary/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center border-r border-primary/20 text-xs font-black uppercase text-primary">#</TableHead>
              {columns.map(col => (
                <TableHead key={col.id} className="border-r border-primary/20 p-2 text-xs font-mono font-black uppercase text-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex items-center gap-1.5">
                      {col.type === "formula" && <Calculator className="size-3 text-primary shrink-0" />}
                      {col.name}
                      <span className="text-[10px] text-muted-foreground font-normal">({col.type})</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (sortCol === col.id) setSortAsc(!sortAsc);
                          else { setSortCol(col.id); setSortAsc(true); }
                        }}
                        className="p-1 hover:bg-primary/20 text-primary"
                        title="Сортировать"
                      >
                        <ArrowUpDown className="size-3" />
                      </button>
                      <button
                        onClick={() => deleteColumn(col.id)}
                        className="p-1 hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                        title="Удалить колонку"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  </div>
                  {col.type === "formula" && col.formula && (
                    <div className="text-[10px] text-primary/80 font-mono mt-0.5 truncate">[{col.formula}]</div>
                  )}
                </TableHead>
              ))}
              <TableHead className="w-16 text-center text-xs font-black uppercase text-primary">ДЕЙСТВИЕ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="h-32 text-center text-muted-foreground text-xs font-mono uppercase">
                  [ НЕТ ДАННЫХ ИЛИ НЕ НАЙДЕНО ПО ФИЛЬТРУ ]
                </TableCell>
              </TableRow>
            ) : (
              processedRows.map((row, idx) => (
                <TableRow key={row.id} className="hover:bg-primary/5 transition border-b border-border/50">
                  <TableCell className="text-center font-mono text-xs text-muted-foreground border-r border-border/50">
                    {idx + 1}
                  </TableCell>
                  {columns.map(col => {
                    const val = getCellValue(row, col);
                    return (
                      <TableCell key={col.id} className="border-r border-border/50 p-1.5 text-xs font-mono">
                        {col.type === "formula" ? (
                          <div className="px-2 py-1.5 font-black text-primary bg-primary/10 border border-primary/20">
                            {typeof val === "number" ? val.toLocaleString() : val}
                          </div>
                        ) : col.type === "status" ? (
                          <Select value={row[col.id] || "Новый"} onValueChange={v => updateCell(row.id, col.id, v)}>
                            <SelectTrigger className="rounded-none h-8 text-xs font-mono bg-background border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-none font-mono">
                              <SelectItem value="Новый">Новый</SelectItem>
                              <SelectItem value="В работе">В работе</SelectItem>
                              <SelectItem value="На складе">На складе</SelectItem>
                              <SelectItem value="Готово">Готово</SelectItem>
                              <SelectItem value="Задерживается">Задерживается</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : col.type === "number" ? (
                          <Input
                            type="number"
                            value={row[col.id] ?? ""}
                            onChange={e => updateCell(row.id, col.id, Number(e.target.value))}
                            className="rounded-none h-8 text-xs font-mono bg-transparent border-transparent focus:border-primary px-2"
                          />
                        ) : (
                          <Input
                            type={col.type === "date" ? "date" : "text"}
                            value={row[col.id] ?? ""}
                            onChange={e => updateCell(row.id, col.id, e.target.value)}
                            className="rounded-none h-8 text-xs font-mono bg-transparent border-transparent focus:border-primary px-2"
                          />
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center p-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRow(row.id)}
                      className="rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-2"
                      title="Удалить строку"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Подвал таблицы: автоматический расчет сумм и средних значений */}
      <div className="border border-primary/40 bg-background/95 p-3 shrink-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
        <div className="flex items-center gap-2 border-r border-border/50 pr-4">
          <span className="text-muted-foreground">ВСЕГО СТРОК:</span>
          <strong className="text-primary font-black text-sm">{processedRows.length}</strong>
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
            <div key={col.id} className="flex flex-col justify-center border-r border-border/50 pr-4 last:border-none">
              <div className="text-[10px] text-muted-foreground uppercase truncate">[{col.name}] СУММА:</div>
              <div className="font-black text-foreground text-sm flex items-center justify-between">
                <span>{sum.toLocaleString()}</span>
                <span className="text-[10px] text-primary/80 font-normal">(СРЕД: {avg})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
