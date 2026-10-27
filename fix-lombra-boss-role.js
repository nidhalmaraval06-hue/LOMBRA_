"use strict";

// LOMBRA: safely promote an existing account to BOSS.
// Place this file beside server.js and lombra.db. Stop the server first.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const readline = require("readline");

const DB_PATH = path.join(__dirname, "lombra.db");
if (!fs.existsSync(DB_PATH)) {
  console.error("خطأ: lombra.db غير موجود. ضع هذا الملف بجانب قاعدة البيانات.");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
let db;

async function main() {
  try {
    const username = (await ask("أدخل اسم الحساب المراد ترقيته (مثلاً admin): ")).trim();
    if (!username) throw new Error("اسم المستخدم فارغ.");

    db = new Database(DB_PATH, { timeout: 5000 });
    db.pragma("busy_timeout = 5000");

    const columns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    for (const required of ["id", "username", "role"]) {
      if (!columns.includes(required)) throw new Error(`عمود ${required} غير موجود في جدول users.`);
    }

    const user = db.prepare("SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1").get(username);
    if (!user) throw new Error("لم يتم العثور على الحساب. لم تتغير أي بيانات.");

    console.log(`\nالحساب: ${user.username}\nالرتبة الحالية: ${user.role}`);
    if (["BOSS", "ADMIN"].includes(String(user.role || "").trim().toUpperCase())) {
      console.log("هذا الحساب لديه صلاحية إدارة بالفعل. لا حاجة للتغيير.");
      return;
    }

    const confirm = (await ask("\nهل تريد تغيير رتبة هذا الحساب فقط إلى BOSS؟ اكتب YES للتأكيد: ")).trim();
    if (confirm !== "YES") {
      console.log("تم الإلغاء. لم تتغير أي بيانات.");
      return;
    }

    // Make a timestamped database backup before changing anything.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(__dirname, `lombra.db.backup-${stamp}`);
    db.pragma("wal_checkpoint(FULL)");
    fs.copyFileSync(DB_PATH, backupPath);

    const result = db.prepare("UPDATE users SET role = ? WHERE id = ?").run("BOSS", user.id);
    if (result.changes !== 1) throw new Error("لم يتم تحديث الحساب. النسخة الاحتياطية محفوظة.");

    console.log("\nنجاح: تم تغيير رتبة الحساب إلى BOSS.");
    console.log(`الحساب: ${user.username}`);
    console.log(`نسخة احتياطية: ${path.basename(backupPath)}`);
    console.log("لم يتم حذف أي حساب أو تغيير كلمة السر.");
    console.log("أعد تشغيل السيرفر ثم سجّل الدخول بالحساب نفسه.");
  } finally {
    if (db) db.close();
    rl.close();
  }
}

main().catch((err) => {
  console.error("\nفشل الإصلاح:", err.message);
  if (db) { try { db.close(); } catch (_) {} }
  rl.close();
  process.exitCode = 1;
});
