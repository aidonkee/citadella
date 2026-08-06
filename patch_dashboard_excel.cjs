const fs = require('fs');
let code = fs.readFileSync('/Users/admin/Downloads/order-whisperer-01-main/src/routes/_authenticated/dashboard.tsx', 'utf-8');

// Add import for export
code = code.replace(
  'import { parseOrderMetadata, buildOrderMetadata } from "@/lib/order-metadata";',
  'import { parseOrderMetadata, buildOrderMetadata } from "@/lib/order-metadata";\nimport { exportOrdersToExcel } from "@/lib/excel-export";'
);

// Add the button next to runAiPoll
code = code.replace(
  '          <Button\n            onClick={runAiPoll}',
  '          <Button\n            onClick={() => exportOrdersToExcel(orders, profiles)}\n            className="h-11 px-5 rounded-none bg-green-600 hover:bg-green-700 text-white font-mono font-bold uppercase tracking-wider shadow-none"\n          >\n            [ EXCEL ]\n          </Button>\n          <Button\n            onClick={runAiPoll}'
);

fs.writeFileSync('/Users/admin/Downloads/order-whisperer-01-main/src/routes/_authenticated/dashboard.tsx', code);
console.log('Successfully patched dashboard.tsx with Excel button');
