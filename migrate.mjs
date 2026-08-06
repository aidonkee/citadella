import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let combinedSql = `-- =============================================================================\n`;
combinedSql += `-- Nerva (OrderFlow) Complete Database Setup Script\n`;
combinedSql += `-- Generated: ${new Date().toISOString()}\n`;
combinedSql += `-- =============================================================================\n\n`;

for (const file of files) {
  combinedSql += `-- =============================================================================\n`;
  combinedSql += `-- Migration: ${file}\n`;
  combinedSql += `-- =============================================================================\n\n`;
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  combinedSql += content.trim() + `\n\n`;
}

const outputPath = path.join(__dirname, 'setup_nerva_database.sql');
fs.writeFileSync(outputPath, combinedSql, 'utf-8');

console.log(`✅ Создан единый SQL-файл со всей структурой базы данных Nerva (${files.length} миграций):`);
console.log(`   📁 ${outputPath} (${(combinedSql.length / 1024).toFixed(1)} KB)`);
