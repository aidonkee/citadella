const fs = require("fs");
const oldFile = fs.readFileSync("/Users/admin/Downloads/order-whisperer-01-main/src/lib/orders.server.ts", "utf-8").split("\n");
const draft = fs.readFileSync("/Users/admin/.gemini/antigravity/brain/08981395-0c08-413a-a447-cbbd99096e12/scratch/orders_server_draft.ts", "utf-8");

const tail = oldFile.slice(515).join("\n");
const newContent = draft + "\n" + tail;

fs.writeFileSync("/Users/admin/Downloads/order-whisperer-01-main/src/lib/orders.server.ts", newContent);
console.log("Successfully patched orders.server.ts");
