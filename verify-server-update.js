#!/usr/bin/env node

/**
 * SERVER UPDATE VERIFICATION SCRIPT
 * This script helps verify if the server has the latest code updates
 */

console.log('🔍 SERVER UPDATE VERIFICATION');
console.log('============================\n');

// Check if we're running the latest version with our fixes
try {
    console.log('✅ Checking codebase for fixes...\n');
    
    const fs = require('fs');
    
    // Check scheduler validation
    const fs = require('fs');
    const schedulerContent = fs.readFileSync('./src/services/scheduler.ts', 'utf8');
    
    if (schedulerContent.includes('trade_call.toLowerCase() === \'hold\'')) {
        console.log('✅ Scheduler hold validation: PRESENT');
    } else {
        console.log('❌ Scheduler hold validation: MISSING');
    }
    
    if (schedulerContent.includes('take_profit === 0 || stop_loss === 0')) {
        console.log('✅ Scheduler TP/SL validation: PRESENT');
    } else {
        console.log('❌ Scheduler TP/SL validation: MISSING');
    }
    
    // Check TIF removal
    const tradeManagementContent = fs.readFileSync('./src/ai/flows/trade-management.ts', 'utf8');
    const tifMatches = tradeManagementContent.match(/tif.*ioc/g);
    
    if (tifMatches) {
        console.log(`⚠️  TIF parameters found: ${tifMatches.length} instances`);
        console.log('   These should only be in market orders, not triggered orders');
    } else {
        console.log('✅ No TIF parameters found in search');
    }
    
    console.log('\n🎯 EXPECTED SERVER BEHAVIOR AFTER UPDATE:');
    console.log('- ✅ Hold trades should be skipped');
    console.log('- ✅ Zero TP/SL trades should be skipped');  
    console.log('- ✅ Valid trades should place conditional orders without TIF errors');
    console.log('- ✅ Multi-TP strategy should work for positions ≥5 contracts');
    
    console.log('\n📋 TO UPDATE SERVER:');
    console.log('cd ~/retro-crypto-alchemist');
    console.log('git pull origin master');
    console.log('npm run build');
    console.log('# Restart application');
    
} catch (error) {
    console.error('❌ Error checking code:', error.message);
}
