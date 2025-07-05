#!/usr/bin/env node
// List and optionally delete positions with missing API credentials
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'trades.db');
const db = new Database(dbPath);

const broken = db.prepare(`
    SELECT id, contract, apiKey, apiSecret, created_at FROM position_states
    WHERE apiKey IS NULL OR apiKey = '' OR apiSecret IS NULL OR apiSecret = ''
    ORDER BY created_at DESC
`).all();

if (broken.length === 0) {
    console.log('✅ No positions with missing API credentials.');
    process.exit(0);
}

console.log('⚠️ Positions with missing API credentials:');
broken.forEach(p => {
    console.log(`- ${p.id} | ${p.contract} | created: ${p.created_at}`);
});

if (process.argv.includes('--delete')) {
    const ids = broken.map(p => p.id);
    const del = db.prepare('DELETE FROM position_states WHERE id = ?');
    ids.forEach(id => del.run(id));
    console.log(`🗑️ Deleted ${ids.length} broken positions.`);
} else {
    console.log('\nTo delete these positions, run: node scripts/cleanup-broken-positions.js --delete');
}
