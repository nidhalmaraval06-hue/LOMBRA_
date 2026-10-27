const fs = require('fs');
const Database = require('better-sqlite3');

const file = './lombra.db';
const backup = './lombra.db.backup-' + Date.now();

fs.copyFileSync(file, backup);

const db = new Database(file);

try {
  db.pragma('foreign_keys = OFF');

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => row.name);

  const remove = [
    'users', 'accounts', 'warnings', 'absences', 'meetings',
    'audit_logs', 'invitation_codes', 'invitations',
    'warning_kick_reviews', 'member_blacklist', 'app_sessions',
    'store_orders', 'store_order_items', 'store_group_messages',
    'store_group_submissions', 'store_group_muted_senders'
  ];

  const clear = db.transaction(() => {
    for (const table of remove) {
      if (tables.includes(table)) {
        db.prepare('DELETE FROM "' + table + '"').run();
        console.log('تم حذف بيانات: ' + table);
      }
    }
  });

  clear();
  console.log('\nتم الحذف بنجاح.');
  console.log('النسخة الاحتياطية: ' + backup);
  console.log('المنتجات وإعدادات الموقع لم يتم حذفها.');
  console.log('يلزم إنشاء حساب BOSS جديد قبل الدخول للوحة الإدارة.');
} catch (error) {
  console.error('خطأ أثناء الحذف:', error.message);
  console.log('النسخة الاحتياطية:', backup);
} finally {
  db.close();
}
