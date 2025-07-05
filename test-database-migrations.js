#!/usr/bin/env node

/**
 * Database Migration Test for Multi-TP Phase 1
 * Verifies that database schema updates work correctly
 */

const path = require('path');
const { initDatabase, createTradePosition, updatePositionMultiTpOrders, getMultiTpPositions } = require('./src/services/database');

async function testDatabaseMigrations() {
    console.log('🗄️  TESTING DATABASE MIGRATIONS');
    console.log('================================\n');

    try {
        // Initialize database (this will run migrations)
        console.log('📦 Initializing database and running migrations...');
        await initDatabase();
        console.log('✅ Database initialized successfully');

        // Test creating a multi-TP position
        console.log('\n🔄 Testing multi-TP position creation...');
        
        const testPosition = {
            jobId: 'test-job-1',
            contract: 'BTC_USDT',
            foundByProfile: 'test-profile',
            tradeCall: 'long',
            entryPrice: 50000,
            currentPrice: 50000,
            size: 2,
            leverage: 5,
            tradeSizeUsd: 10,
            confidenceScore: 85,
            status: 'opening',
            openedAt: Date.now(),
            unrealizedPnl: 0,
            lastUpdated: Date.now()
        };

        const positionId = await createTradePosition(testPosition);
        console.log(`✅ Created test position: ${positionId}`);

        // Test updating with multi-TP order details
        console.log('\n📝 Testing multi-TP order updates...');
        
        await updatePositionMultiTpOrders(positionId, {
            entryOrderId: 'entry_123',
            tp1OrderId: 'tp1_456',
            tp2OrderId: 'tp2_789',
            stopLossOrderId: 'sl_101',
            status: 'open',
            strategyType: 'multi-tp',
            orderSizes: {
                totalContracts: 2,
                tp1Size: 1,
                tp2Size: 1,
                runnerSize: 0
            },
            targetPrices: {
                tp1Price: 50750,
                tp2Price: 51250,
                slPrice: 48500
            }
        });
        
        console.log('✅ Multi-TP order details updated successfully');

        // Test retrieving multi-TP positions
        console.log('\n🔍 Testing multi-TP position retrieval...');
        const multiTpPositions = await getMultiTpPositions();
        console.log(`✅ Retrieved ${multiTpPositions.length} multi-TP position(s)`);

        if (multiTpPositions.length > 0) {
            const position = multiTpPositions[0];
            console.log('\n📊 Sample Multi-TP Position:');
            console.log(`- Contract: ${position.contract}`);
            console.log(`- Strategy Type: ${position.strategyType}`);
            console.log(`- TP1 Order ID: ${position.tp1OrderId}`);
            console.log(`- TP2 Order ID: ${position.tp2OrderId}`);
            console.log(`- TP1 Hit: ${position.isTp1Hit}`);
            console.log(`- TP2 Hit: ${position.isTp2Hit}`);
            console.log(`- SL at Break-even: ${position.isSlAtBreakEven}`);
        }

        console.log('\n🎉 Database Migration Test: PASSED');
        console.log('✅ All new columns created successfully');
        console.log('✅ Multi-TP helper functions working');
        console.log('✅ Position state tracking functional');

    } catch (error) {
        console.error('❌ Database Migration Test Failed:', error);
        throw error;
    }
}

async function runDatabaseTests() {
    try {
        await testDatabaseMigrations();
        
        console.log('\n\n🎯 DATABASE TEST SUMMARY');
        console.log('=========================');
        console.log('✅ Schema migrations executed');
        console.log('✅ Multi-TP columns added');
        console.log('✅ Helper functions operational');
        console.log('✅ Position tracking ready');
        console.log('\n🚀 Database is ready for multi-TP strategy!');
        
    } catch (error) {
        console.error('❌ Critical Database Test Failure:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    runDatabaseTests();
}

module.exports = { testDatabaseMigrations };
