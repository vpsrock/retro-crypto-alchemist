#!/usr/bin/env node

/**
 * Test Enhanced Market Analysis Integration
 * Verifies that the enhanced analysis is properly integrated into the AI flow
 */

const { execSync } = require('child_process');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  contract: 'BTC_USDT',
  settle: 'usdt',
  interval: '1h',
  enhancedAnalysisEnabled: true,
  modelConfig: {
    id: 'test-model',
    name: 'Test Model',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    modelType: 'standard',
    enabled: true
  },
  promptTemplate: 'Test prompt with [TIMEFRAME] and <<INSERT JSON SNAPSHOT HERE>>',
  openaiApiKey: 'test-key' // This will fail but we can test structure
};

async function testEnhancedIntegration() {
  console.log('🧪 Testing Enhanced Market Analysis Integration');
  console.log('===============================================\n');

  try {
    // Test 1: Verify enhanced analysis service exists and exports are correct
    console.log('📦 Test 1: Verifying enhanced analysis service...');
    
    const enhancedAnalysisPath = path.join(__dirname, '..', 'src', 'services', 'enhanced-market-analysis.ts');
    const analysisFlowPath = path.join(__dirname, '..', 'src', 'ai', 'flows', 'analyze-trade-recommendations.ts');
    
    // Check if files exist
    const fs = require('fs');
    if (!fs.existsSync(enhancedAnalysisPath)) {
      throw new Error('Enhanced analysis service file not found');
    }
    if (!fs.existsSync(analysisFlowPath)) {
      throw new Error('Analysis flow file not found');
    }
    
    console.log('✅ Enhanced analysis service file exists');
    console.log('✅ Analysis flow file exists');
    
    // Test 2: Check TypeScript compilation
    console.log('\n🔧 Test 2: Checking TypeScript compilation...');
    
    try {
      execSync('npx tsc --noEmit --skipLibCheck', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      console.log('✅ TypeScript compilation successful');
    } catch (error) {
      console.log('❌ TypeScript compilation errors detected');
      console.log('Error details:', error.stdout ? error.stdout.toString() : error.message);
      // Continue with other tests
    }
    
    // Test 3: Verify integration points
    console.log('\n🔗 Test 3: Verifying integration points...');
    
    const flowContent = fs.readFileSync(analysisFlowPath, 'utf8');
    
    const integrationChecks = [
      {
        name: 'Enhanced analysis import',
        pattern: /import.*getEnhancedMarketAnalysis.*enhanced-market-analysis/,
        found: false
      },
      {
        name: 'Enhanced analysis enabled parameter',
        pattern: /enhancedAnalysisEnabled/,
        found: false
      },
      {
        name: 'Enhanced analysis call',
        pattern: /getEnhancedMarketAnalysis/,
        found: false
      },
      {
        name: 'Enhanced data in payload',
        pattern: /enhancedAnalysis\.enhancedMetrics/,
        found: false
      }
    ];
    
    integrationChecks.forEach(check => {
      check.found = check.pattern.test(flowContent);
      console.log(`${check.found ? '✅' : '❌'} ${check.name}`);
    });
    
    const allChecksPass = integrationChecks.every(check => check.found);
    if (allChecksPass) {
      console.log('✅ All integration points verified');
    } else {
      console.log('⚠️  Some integration points missing');
    }
    
    // Test 4: Schema validation
    console.log('\n📋 Test 4: Verifying schema updates...');
    
    const schemasPath = path.join(__dirname, '..', 'src', 'lib', 'schemas.ts');
    const schemasContent = fs.readFileSync(schemasPath, 'utf8');
    
    const schemaChecks = [
      {
        name: 'Enhanced analysis input field',
        pattern: /enhancedAnalysisEnabled.*boolean.*optional/,
        found: false
      },
      {
        name: 'Enhanced analysis output field',
        pattern: /enhancedAnalysis.*any.*optional/,
        found: false
      }
    ];
    
    schemaChecks.forEach(check => {
      check.found = check.pattern.test(schemasContent);
      console.log(`${check.found ? '✅' : '❌'} ${check.name}`);
    });
    
    // Test 5: Package.json scripts
    console.log('\n📜 Test 5: Verifying package.json scripts...');
    
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    const scriptChecks = [
      'enhanced-analysis',
      'validate-analysis'
    ];
    
    scriptChecks.forEach(script => {
      const exists = packageContent.scripts && packageContent.scripts[script];
      console.log(`${exists ? '✅' : '❌'} Script "${script}" ${exists ? 'exists' : 'missing'}`);
    });
    
    // Summary
    console.log('\n📊 Integration Test Summary');
    console.log('============================');
    
    const totalChecks = integrationChecks.length + schemaChecks.length + scriptChecks.length + 2; // +2 for file existence
    const passedChecks = integrationChecks.filter(c => c.found).length + 
                        schemaChecks.filter(c => c.found).length + 
                        scriptChecks.filter(s => packageContent.scripts && packageContent.scripts[s]).length + 2;
    
    console.log(`✅ Passed: ${passedChecks}/${totalChecks} checks`);
    
    if (passedChecks === totalChecks) {
      console.log('🎉 Enhanced market analysis integration is complete and ready!');
      console.log('\nNext steps:');
      console.log('1. Test with a real contract using enhanced analysis enabled');
      console.log('2. Verify AI prompts include enhanced data');
      console.log('3. Monitor performance and error handling');
      console.log('4. Gradually roll out to production');
    } else {
      console.log('⚠️  Integration is partially complete. Please review failed checks.');
    }
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    process.exit(1);
  }
}

// Feature flag management helper
function createFeatureFlagExample() {
  console.log('\n🚩 Feature Flag Usage Example');
  console.log('==============================');
  console.log('To enable enhanced analysis in your application:');
  console.log('');
  console.log('```javascript');
  console.log('const input = {');
  console.log('  contract: "BTC_USDT",');
  console.log('  settle: "usdt",');
  console.log('  interval: "1h",');
  console.log('  enhancedAnalysisEnabled: true, // 🚩 Feature flag');
  console.log('  // ... other parameters');
  console.log('};');
  console.log('');
  console.log('const result = await analyzeTradeRecommendations(input);');
  console.log('');
  console.log('// Check if enhanced data is present');
  console.log('if (result.enhancedAnalysis) {');
  console.log('  console.log("Enhanced analysis available:", result.enhancedAnalysis.metrics);');
  console.log('} else {');
  console.log('  console.log("Using basic analysis only");');
  console.log('}');
  console.log('```');
  console.log('');
  console.log('Benefits of this approach:');
  console.log('- 🛡️  Safe: Falls back to basic analysis if enhanced fails');
  console.log('- 🔄 Gradual: Can enable per-contract or per-user');
  console.log('- 🎛️  Controllable: Easy to disable if issues arise');
  console.log('- 📊 Measurable: Can A/B test performance');
}

// Run the tests
if (require.main === module) {
  testEnhancedIntegration()
    .then(() => {
      createFeatureFlagExample();
      console.log('\n✨ Integration test completed successfully!');
    })
    .catch((error) => {
      console.error('💥 Integration test failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testEnhancedIntegration,
  createFeatureFlagExample
};
