const fs = require('fs');
let code = fs.readFileSync('src/lib/orders.server.ts', 'utf-8');

// The replacement content had backslashes. Let's fix them.
code = code.replace(/\\`/g, '`');
code = code.replace(/\\\${/g, '${');

fs.writeFileSync('src/lib/orders.server.ts', code);
console.log('Fixed syntax errors in orders.server.ts');
