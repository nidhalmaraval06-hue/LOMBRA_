
"use strict";

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "lombra.db");

if (!fs.existsSync(DB_PATH)) {
    console.error("خطأ: ملف lombra.db غير موجود.");
    process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
    try {
        const columns = db.prepare("PRAGMA table_info(users)")
            .all()
            .map(column => column.name);

        for (const column of ["id", "username", "password_hash", "role"]) {
            if (!columns.includes(column)) {
                throw new Error(`عمود ${column} غير موجود في جدول users.`);
            }
        }

        const username = (await ask(
            "أدخل اسم مستخدم حساب BOSS كما هو في قاعدة البيانات: "
        )).trim();

        if (!username) {
            throw new Error("اسم المستخدم لا يمكن أن يكون فارغاً.");
        }

        const user = db.prepare(`
            SELECT id, username, role
            FROM users
            WHERE username = ?
            LIMIT 1
        `).get(username);

        if (!user) {
            throw new Error(
                "لم يتم العثور على هذا الحساب. تحقق من اسم المستخدم."
            );
        }

        if (!["BOSS", "ADMIN"].includes(
            String(user.role || "").trim().toUpperCase()
        )) {
            throw new Error(
                "الحساب المحدد ليس BOSS أو ADMIN. لم يتم تعديل أي بيانات."
            );
        }

        console.log(`تم العثور على حساب الإدارة: ${user.username}`);

        const password = await ask(
            "أدخل كلمة المرور الجديدة (12 حرفاً على الأقل): "
        );

        if (password.length < 12 || password.length > 72) {
            throw new Error(
                "كلمة المرور يجب أن تكون بين 12 و72 حرفاً."
            );
        }

        const confirm = await ask("أعد كتابة كلمة المرور للتأكيد: ");

        if (password !== confirm) {
            throw new Error("كلمتا المرور غير متطابقتين.");
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const update = db.prepare(`
            UPDATE users
            SET password_hash = ?
            WHERE id = ? AND username = ?
        `);

        const result = update.run(
            passwordHash,
            user.id,
            user.username
        );

        if (result.changes !== 1) {
            throw new Error("لم يتم تحديث الحساب.");
        }

        console.log("\nنجاح: تم تحديث كلمة مرور حساب الإدارة.");
        console.log("لم يتم حذف الحساب أو تغيير الرتبة أو الصلاحيات.");
        console.log("جرّب تسجيل الدخول بكلمة المرور الجديدة.");

    } finally {
        rl.close();
        db.close();
    }
}

main().catch(error => {
    console.error("\nفشل الإصلاح:", error.message);

    try {
        db.close();
    } catch {}
    
    process.exitCode = 1;
});
