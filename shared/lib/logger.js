/**
 * logger.js — 统一日志
 */

const isDebug = process.env.DEBUG === 'true';

export function logInfo(msg) { console.log(`[INFO] ${msg}`); }
export function logError(msg, err = '') { console.error(`[ERROR] ❌ ${msg}`, err); }
export function logDebug(msg, data = null) {
    if (!isDebug) return;
    console.log(`[DEBUG] 🐛 ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}
