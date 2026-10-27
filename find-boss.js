
"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "lombra.db"), {
    readonly: true
});

try {
    const users = db.prepare(`
        SELECT username, role, active
        FROM users
        ORDER BY id
    `).all();

    console.log("\n===== LOMBRA ACCOUNTS =====");

    for (const user of users) {
        console.log(
            "Username:", user.username,
            "| Role:", user.role,
            "| Active:", user.active
        );
    }

    console.log("===========================\n");
} catch (error) {
    console.log("Error:", error.message);
} finally {
    db.close();
}
