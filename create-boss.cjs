const readline = require("readline");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (q) => new Promise(resolve => rl.question(q, resolve));

(async () => {
  const username = (await ask("اسم مستخدم BOSS الجديد: ")).trim();
  const password = await ask("كلمة سر BOSS الجديدة: ");
  rl.close();

  if (!username || password.length < 10) {
    console.log("اسم المستخدم مطلوب، وكلمة السر لازم تكون 10 أحرف على الأقل.");
    process.exitCode = 1;
    return;
  }

  const db = new Database("./lombra.db");

  try {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const required = ["username", "display_name", "password_hash", "role", "active", "permissions_json"];
    const missing = required.filter(c => !columns.some(x => x.name === c));

    if (missing.length) {
      console.log("توقفت العملية؛ أعمدة غير موجودة:", missing.join(", "));
      return;
    }

    const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (exists) {
      console.log("اسم المستخدم موجود مسبقاً. لم يتم إجراء أي تغيير.");
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const permissionNames = [
      "dashboard","accounts","products","orders","warnings",
      "absences","meetings","invitations","blacklist","settings"
    ];
    const permissions = Object.fromEntries(permissionNames.map(p => [p, true]));

    const insert = db.prepare(`
      INSERT INTO users
      (username, display_name, password_hash, role, active, permissions_json, created_at)
      VALUES (?, ?, ?, 'BOSS', 1, ?, CURRENT_TIMESTAMP)
    `);

    insert.run(username, username, hash, JSON.stringify(permissions));
    console.log("تم إنشاء حساب BOSS. جرّب تسجيل الدخول بالبيانات الجديدة.");
  } catch (e) {
    console.log("لم يتم إنشاء الحساب:", e.message);
  } finally {
    db.close();
  }
})().catch(e => {
  rl.close();
  console.log("خطأ:", e.message);
});
