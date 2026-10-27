"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { createClient } = require("@libsql/client");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error("ERROR: SESSION_SECRET يجب أن يكون 32 حرفاً على الأقل.");
    process.exit(1);
}

// ==================================================
// 1. إعداد الاتصال بقاعدة البيانات (Turso / SQLite)
// ==================================================

const isTurso = Boolean(process.env.TURSO_DATABASE_URL);
let db;

if (isTurso) {
    db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log("Connected to Turso Cloud Database.");
} else {
    const Database = require("better-sqlite3");
    const DB_PATH = path.join(__dirname, "lombra.db");
    if (!fs.existsSync(DB_PATH)) {
        console.error("ERROR: lombra.db غير موجود محلياً ولم يتم تزويد TURSO_DATABASE_URL.");
        process.exit(1);
    }
    const localDb = new Database(DB_PATH);
    localDb.pragma("busy_timeout = 5000");
    localDb.pragma("journal_mode = WAL");

    // غلاف للتوافق (Wrapper) لتوحيد استدعاءات Async مع libsql
    db = {
        execute: async (sql, args = []) => {
            const stmt = localDb.prepare(typeof sql === 'string' ? sql : sql.sql);
            if (stmt.reader) {
                const rows = stmt.all(...(Array.isArray(args) ? args : Object.values(args)));
                return { rows };
            } else {
                const info = stmt.run(...(Array.isArray(args) ? args : Object.values(args)));
                return { rows: [], rowsAffected: info.changes, insertId: info.lastInsertRowid };
            }
        },
        batch: async (statements) => {
            const results = [];
            localDb.transaction(() => {
                for (const stmt of statements) {
                    const prepared = localDb.prepare(typeof stmt === 'string' ? stmt : stmt.sql);
                    const args = stmt.args || [];
                    if (prepared.reader) {
                        results.push({ rows: prepared.all(...args) });
                    } else {
                        const info = prepared.run(...args);
                        results.push({ rows: [], rowsAffected: info.changes, insertId: info.lastInsertRowid });
                    }
                }
            })();
            return results;
        }
    };
}

app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: false }));

// ==================================================
// 2. تهيئة قواعد البيانات والمخطط (Schema Initialization)
// ==================================================

async function initDatabaseSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'MEMBER',
            active INTEGER NOT NULL DEFAULT 1,
            permissions_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            discord_id TEXT,
            discord_username TEXT,
            discord_global_name TEXT,
            discord_avatar TEXT
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS invitation_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_hash TEXT NOT NULL UNIQUE,
            code_hint TEXT NOT NULL,
            code_value TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            used_by INTEGER,
            used_at TEXT
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS warning_kick_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            warning_count INTEGER NOT NULL DEFAULT 3,
            status TEXT NOT NULL DEFAULT 'pending',
            created_by INTEGER,
            decided_by INTEGER,
            decision_note TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            decided_at TEXT
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price INTEGER NOT NULL DEFAULT 0,
            image TEXT NOT NULL DEFAULT '',
            custom_amount INTEGER NOT NULL DEFAULT 0,
            product_type TEXT NOT NULL DEFAULT 'PRODUCT',
            discount_percent INTEGER NOT NULL DEFAULT 0,
            description TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_orders (
            id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_discord TEXT NOT NULL DEFAULT '',
            total INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'قيد المراجعة',
            store_group_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            image TEXT NOT NULL DEFAULT '',
            unit_price INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            line_total INTEGER NOT NULL
        );
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // إدخال المنتجات الافتراضية إذا كانت الطاولة فارغة
    const existingProducts = await db.execute("SELECT COUNT(*) as cnt FROM store_products");
    if (Number(existingProducts.rows[0].cnt) === 0) {
        const defaultProducts = [
            { id: "pdw", name: "PDW", price: 3500, image: "pdw.png", custom_amount: 0 },
            { id: "ak47", name: "AK-47", price: 8500, image: "ak47.png", custom_amount: 0 },
            { id: "combat-pistol", name: "COMBAT PISTOL", price: 2500, image: "combat-pistol.png", custom_amount: 0 },
            { id: "micro-smg", name: "MICRO SMG", price: 5000, image: "micro-smg.png", custom_amount: 0 },
            { id: "dirty-money", name: "DIRTY MONEY", price: 0, image: "marked.money.png", custom_amount: 1 }
        ];

        for (const p of defaultProducts) {
            await db.execute({
                sql: `INSERT OR IGNORE INTO store_products (id, name, price, image, custom_amount) VALUES (?, ?, ?, ?, ?)`,
                args: [p.id, p.name, p.price, p.image, p.custom_amount]
            });
        }
    }
}

initDatabaseSchema().catch(err => {
    console.error("Database schema init error:", err);
});

// ==================================================
// 3. الصلاحيات والرتب والوظائف المساعدة
// ==================================================

const PERMISSION_NAMES = [
    "manageAccounts", "addWarnings", "reviewAbsences",
    "manageMeetings", "viewAllMembers", "viewAuditLogs"
];

const ALL_PERMISSIONS = Object.fromEntries(PERMISSION_NAMES.map(name => [name, true]));

function parsePermissions(value) {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function normalizeRole(role) {
    const normalized = String(role || "MEMBER").trim().toUpperCase();
    return normalized === "BUSNESMANAGER" ? "BUSINESSMANAGER" : normalized;
}

function isBoss(account) {
    return Boolean(account) && ["BOSS", "ADMIN"].includes(normalizeRole(account.role));
}

function permissionsFor(account) {
    if (isBoss(account)) return ALL_PERMISSIONS;
    return parsePermissions(account?.permissions);
}

function hasPermission(account, permission) {
    return isBoss(account) || permissionsFor(account)[permission] === true;
}

async function recordAudit(req, action, details = "") {
    const account = req.session?.account;
    try {
        await db.execute({
            sql: `INSERT INTO audit_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)`,
            args: [
                account?.id || null,
                account?.username || "SYSTEM",
                action,
                String(details).slice(0, 1000)
            ]
        });
    } catch (e) {
        console.error("Audit error:", e.message);
    }
}

function publicUser(row) {
    return {
        id: row.id,
        username: row.username,
        display_name: row.display_name || row.username,
        role: normalizeRole(row.role),
        active: Number(row.active) === 1,
        permissions: parsePermissions(row.permissions_json),
        discord_id: row.discord_id || null,
        discord_username: row.discord_username || null,
        discord_global_name: row.discord_global_name || null,
        discord_avatar: row.discord_avatar || null,
        created_at: row.created_at || null,
        invitation_code: row.invitation_code || null
    };
}

// ==================================================
// 4. الجلسات والمصادقة
// ==================================================

app.use(session({
    name: "lombra.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 60 * 60 * 1000
    }
}));

app.use(async (req, res, next) => {
    const account = req.session?.account;
    if (!account) return next();

    const resDb = await db.execute({ sql: "SELECT active FROM users WHERE id = ?", args: [account.id] });
    const row = resDb.rows[0];
    if (row && Number(row.active) === 1) return next();

    return req.session.destroy(() => {
        if (req.path.startsWith("/api/")) {
            res.status(403).json({
                success: false,
                code: "ACCOUNT_DISABLED",
                message: "تم تعطيل حسابك من إدارة LOMBRA STORE."
            });
        } else {
            res.redirect("/login.html?disabled=1");
        }
    });
});

async function requireLogin(req, res, next) {
    if (!req.session.account) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json({ success: false, message: "يرجى تسجيل الدخول أولاً." });
        }
        return res.redirect("/login.html");
    }
    next();
}

function requireBoss(req, res, next) {
    if (!req.session.account) {
        return res.status(401).json({ success: false, message: "يرجى تسجيل الدخول أولاً." });
    }
    if (!isBoss(req.session.account)) {
        return res.status(403).json({ success: false, message: "ليس لديك صلاحية القائد." });
    }
    next();
}

// ==================================================
// 5. تسجيل الدخول العادي وتسجيل الخروج
// ==================================================

app.post("/api/login", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ success: false, message: "أدخل اسم المستخدم وكلمة المرور." });
        }

        const resUser = await db.execute({
            sql: `SELECT id, username, password_hash, role, display_name, active, permissions_json FROM users WHERE username = ? LIMIT 1`,
            args: [username]
        });
        const user = resUser.rows[0];

        if (!user || Number(user.active) !== 1) {
            return res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة أو الحساب معطّل." });
        }

        let storedHash = user.password_hash;
        if (Buffer.isBuffer(storedHash) || storedHash instanceof Uint8Array) {
            storedHash = Buffer.from(storedHash).toString("utf8").trim();
        } else if (storedHash && typeof storedHash === "object" && storedHash.type === "Buffer" && Array.isArray(storedHash.data)) {
            storedHash = Buffer.from(storedHash.data).toString("utf8").trim();
        }

        if (typeof storedHash !== "string" || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(storedHash)) {
            return res.status(500).json({
                success: false,
                message: "تنسيق كلمة المرور المخزنة غير صالح. الحساب محفوظ؛ يلزم إصلاح آمن لكلمة المرور."
            });
        }

        const validPassword = await bcrypt.compare(password, storedHash);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة أو الحساب معطّل." });
        }

        const account = {
            id: user.id,
            username: user.username,
            displayName: user.display_name || user.username,
            role: normalizeRole(user.role),
            permissions: parsePermissions(user.permissions_json)
        };

        req.session.regenerate(async error => {
            if (error) return res.status(500).json({ success: false, message: "تعذّر إنشاء جلسة الدخول." });
            req.session.account = account;
            req.session.save(async saveError => {
                if (saveError) return res.status(500).json({ success: false, message: "تعذّر حفظ جلسة الدخول." });
                await recordAudit({ session: { account } }, "LOGIN", "تم تسجيل الدخول");
                res.json({
                    success: true,
                    message: "تم تسجيل الدخول بنجاح.",
                    destination: isBoss(account) ? "/dashboard.html" : "/member.html",
                    account
                });
            });
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "حدث خطأ داخلي في الخادم." });
    }
});

app.post("/api/logout", (req, res) => {
    if (!req.session) return res.json({ success: true });
    req.session.destroy(error => {
        if (error) return res.status(500).json({ success: false, message: "تعذّر تسجيل الخروج." });
        res.clearCookie("lombra.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });
        res.json({ success: true });
    });
});

// ==================================================
// 6. ملفات الموقع والمسارات
// ==================================================

app.use(express.static(__dirname, { index: false, dotfiles: "deny" }));

app.get("/", (req, res) => res.redirect("/login.html"));

app.get("/dashboard.html", requireLogin, (req, res, next) => {
    if (!isBoss(req.session.account)) return res.redirect("/member.html");
    next();
}, (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/member.html", requireLogin, (req, res, next) => {
    if (isBoss(req.session.account)) return res.redirect("/dashboard.html");
    next();
}, (req, res) => {
    res.sendFile(path.join(__dirname, "member.html"));
});

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ success: false, message: "مسار API غير موجود." });
    }
    res.status(404).send("404 - الصفحة غير موجودة");
});

// ==================================================
// 7. تشغيل الخادم
// ==================================================

const server = app.listen(PORT, () => {

    console.log("--------------------------------------");

    console.log(" LOMBRA MAFIA | OBSIDIAN NOIR");

    console.log(` http://localhost:${PORT}`);

    console.log(` Database: ${isTurso ? "Turso Cloud DB" : "lombra.db Local"}`);

    console.log(" Store API: /api/store/products");

    console.log(" Admin API: /api/boss/store/products");

    console.log("--------------------------------------");

});

function shutdown() {
    server.close(() => {
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);