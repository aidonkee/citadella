const fs = require('fs');
let code = fs.readFileSync('/Users/admin/Downloads/order-whisperer-01-main/src/routes/_authenticated/dashboard.tsx', 'utf-8');

// Insert new fields in the modal UI
const insertUI = `
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Этап</label>
                  <select
                    defaultValue={parseOrderMetadata(editingOrder.comment).stage}
                    id="edit-order-stage"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  >
                    <option value="Новый">Новый</option>
                    <option value="Производство">Производство</option>
                    <option value="Логистика">Логистика</option>
                    <option value="Готово">Готово</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Приоритет</label>
                  <select
                    defaultValue={parseOrderMetadata(editingOrder.comment).priority}
                    id="edit-order-priority"
                    className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                  >
                    <option value="Обычный">Обычный</option>
                    <option value="Средний">Средний</option>
                    <option value="Высокий">Высокий</option>
                    <option value="Срочно">Срочно</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-muted-foreground mb-1">Доп. Комментарий</label>
                <input
                  type="text"
                  defaultValue={parseOrderMetadata(editingOrder.comment).comment}
                  id="edit-order-comment"
                  className="w-full bg-background border border-border px-3 py-2 text-foreground font-mono focus:outline-none focus:border-primary rounded-none"
                />
              </div>
`;

code = code.replace(
  '              <div className="grid grid-cols-2 gap-3">',
  insertUI + '\n              <div className="grid grid-cols-2 gap-3">'
);

// Update save logic
const newSaveLogic = `
                  const numEl = document.getElementById("edit-order-number") as HTMLInputElement;
                  const nomEl = document.getElementById("edit-order-nom") as HTMLInputElement;
                  const statusEl = document.getElementById("edit-order-status") as HTMLSelectElement;
                  const dateEl = document.getElementById("edit-order-date") as HTMLInputElement;
                  const respEl = document.getElementById("edit-order-resp") as HTMLSelectElement;
                  
                  const stageEl = document.getElementById("edit-order-stage") as HTMLSelectElement;
                  const priorityEl = document.getElementById("edit-order-priority") as HTMLSelectElement;
                  const commentEl = document.getElementById("edit-order-comment") as HTMLInputElement;
                  
                  const newCommentStr = buildOrderMetadata({
                    stage: stageEl.value as any,
                    priority: priorityEl.value as any,
                    comment: commentEl.value.trim()
                  }, editingOrder.comment);

                  try {
                    await updateOrderDetails({
                      data: {
                        order_id: editingOrder.id,
                        number: numEl.value.trim() || editingOrder.number,
                        nomenclature: nomEl.value.trim() || editingOrder.nomenclature,
                        status: statusEl.value as any,
                        finish_date: dateEl.value ? dateEl.value : null,
                        responsible_user_id: respEl.value ? respEl.value : null,
                        comment: newCommentStr
                      }
`;

code = code.replace(
  /                  const numEl = document\.getElementById\("edit-order-number"\)[\s\S]*?responsible_user_id: respEl\.value \? respEl\.value : null,[\s\S]*?\}/,
  newSaveLogic
);

fs.writeFileSync('/Users/admin/Downloads/order-whisperer-01-main/src/routes/_authenticated/dashboard.tsx', code);
console.log('Successfully patched dashboard.tsx edit modal');
