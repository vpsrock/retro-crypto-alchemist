// Debug script to check API key retrieval
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./trades.db');

console.log('=== CHECKING API KEYS IN DATABASE ===');

// Check app_settings table
db.all("SELECT * FROM app_settings WHERE category = 'api_keys'", [], (err, rows) => {
    if (err) {
        console.error('Error reading app_settings:', err);
    } else {
        console.log('\n📊 app_settings with api_keys category:');
        if (rows.length === 0) {
            console.log('❌ NO API KEYS FOUND in app_settings!');
        } else {
            rows.forEach(row => {
                try {
                    const data = JSON.parse(row.data);
                    console.log('✅ Found API keys:', {
                        category: row.category,
                        gateIoKey: data.gateIoKey ? `${data.gateIoKey.substring(0, 8)}...` : 'EMPTY',
                        gateIoSecret: data.gateIoSecret ? `${data.gateIoSecret.substring(0, 8)}...` : 'EMPTY',
                        openaiApiKey: data.openaiApiKey ? `${data.openaiApiKey.substring(0, 8)}...` : 'EMPTY'
                    });
                } catch (parseErr) {
                    console.error('❌ Failed to parse API key data:', parseErr);
                    console.log('Raw data:', row.data);
                }
            });
        }
    }
    
    // Also check if there are any other tables with API keys
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%api%'", [], (err, tables) => {
        if (!err && tables.length > 0) {
            console.log('\n📋 Tables with "api" in schema:', tables.map(t => t.name));
        }
        
        // Check recent position_states for API credentials
        db.all(`
            SELECT id, contract, api_key, api_secret, created_at 
            FROM position_states 
            WHERE created_at > datetime('now', '-1 day') 
            ORDER BY created_at DESC 
            LIMIT 10
        `, [], (err, positions) => {
            if (err) {
                console.error('Error reading position_states:', err);
            } else {
                console.log('\n🔍 Recent positions (last 24h):');
                positions.forEach(pos => {
                    console.log(`- ${pos.contract}: api_key=${pos.api_key ? `${pos.api_key.substring(0, 4)}...` : 'NULL'}, api_secret=${pos.api_secret ? `${pos.api_secret.substring(0, 4)}...` : 'NULL'} (${pos.created_at})`);
                });
            }
            
            db.close();
        });
    });
});
