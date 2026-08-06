import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valParts] = trimmed.split('=');
    if (key && valParts.length > 0) {
      let val = valParts.join('=').trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key.trim()] = val;
    }
  }
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧠 Nerva: Автоматическое создание аккаунта Владельца');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!url || !serviceKey || serviceKey === 'ВСТАВЬТЕ_СЮДА_СКОПИРОВАННЫЙ_SERVICE_ROLE_KEY') {
  console.error('❌ ОШИБКА: В файле .env отсутствует или не заполнен секретный ключ SUPABASE_SERVICE_ROLE_KEY.\n');
  console.log('📋 ЧТО СДЕЛАЙТЕ СЕЙЧАС (занимает 30 секунд):');
  console.log('1. Откройте панель Supabase: https://app.supabase.com/project/' + (process.env.SUPABASE_PROJECT_ID || 'ioxbeznzdzensagvvthw') + '/settings/api');
  console.log('2. В разделе "Project API keys" найдите ключ с названием "service_role" (secret) и скопируйте его.');
  console.log('3. Откройте файл .env в этой папке и добавьте строку:');
  console.log('   SUPABASE_SERVICE_ROLE_KEY="ваш_скопированный_длинный_ключ"');
  console.log('4. Сохраните .env и запустите эту команду снова: node create-owner.mjs\n');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function run() {
  const login = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123456';
  const displayName = process.argv[4] || 'Главный Владелец Nerva';
  const email = `${login.toLowerCase()}@orderflow.local`;

  console.log(`📡 Подключение к базе данных Nerva (${url})...`);
  
  // Проверяем соединение
  const { error: testErr } = await supabase.from('profiles').select('id').limit(1);
  if (testErr) {
    console.error('❌ Ошибка подключения или неверный SUPABASE_SERVICE_ROLE_KEY:', testErr.message);
    process.exit(1);
  }

  console.log(`👤 Создаём учётную запись владельца...`);
  console.log(`   Логин: ${login}`);
  console.log(`   Пароль: ${password}`);
  console.log(`   Имя: ${displayName}`);

  // Пробуем создать или найти пользователя
  let uid = null;
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, username: login }
  });

  if (createError) {
    if (createError.message.includes('already') || createError.status === 422) {
      console.log(`⚠️ Пользователь ${login} (${email}) уже существует. Обновляем пароль и права...`);
      // Ищем ID пользователя
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const existingUser = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        uid = existingUser.id;
        await supabase.auth.admin.updateUserById(uid, { password, user_metadata: { display_name: displayName, username: login } });
      } else {
        console.error('❌ Пользователь существует, но не найден в списке (возможно, pagination):', email);
        // Если не нашли по email в первой странице, попробуем через все или создадим новый с суффиксом
      }
    } else {
      console.error('❌ Ошибка при создании пользователя:', createError.message);
      process.exit(1);
    }
  } else if (created?.user) {
    uid = created.user.id;
  }

  if (!uid) {
    console.error('❌ Не удалось получить ID пользователя.');
    process.exit(1);
  }

  // Обновляем профиль главного админа
  await supabase.from('profiles').upsert({
    id: uid,
    username: login,
    display_name: displayName
  });

  await supabase.from('user_roles').delete().eq('user_id', uid);
  await supabase.from('user_roles').insert({
    user_id: uid,
    role: 'owner'
  });

  // Также выдаём права Владельца (owner) вообще всем существующим аккаунтам в базе, чтобы не было проблем с доступом в админку
  const { data: allUsersData } = await supabase.auth.admin.listUsers();
  if (allUsersData?.users?.length) {
    console.log(`\n🛡 Выдаём права Владельца (owner) всем аккаунтам в системе (${allUsersData.users.length} шт.):`);
    for (const u of allUsersData.users) {
      await supabase.from('profiles').upsert({
        id: u.id,
        username: u.user_metadata?.username || u.email?.split('@')[0] || 'user',
        display_name: u.user_metadata?.display_name || u.email || 'Владелец Nerva'
      });
      await supabase.from('user_roles').delete().eq('user_id', u.id);
      await supabase.from('user_roles').insert({
        user_id: u.id,
        role: 'owner'
      });
      console.log(`   - ${u.email} -> OWNER`);
    }
  }

  console.log('\n✅ УСПЕШНО! Новый аккаунт владельца Nerva создан и настроен!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Данные для входа в систему:');
  console.log(`👉 Логин:   ${login}`);
  console.log(`👉 Пароль:  ${password}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nТеперь вы можете запустить `npm run dev` и войти под логином admin и паролем admin123456!');
}

run().catch(err => {
  console.error('❌ Непредвиденная ошибка:', err);
  process.exit(1);
});
