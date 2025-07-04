const crypto = require('crypto');

// Your credentials
const GATEIO_API_KEY = "f1a4c6e6be93be9872c7e6b301b357a8";
const GATEIO_API_SECRET = "39d62972b6e4eefb2f3df355caedc7ff99fb1d319668f8259747adc0ef4e3070";

function createGateIOSignature(method, url, queryParam, payloadString, apiSecret) {
  const timestamp = (new Date().getTime() / 1000).toString();
  const hashedPayload = crypto.createHash('sha512').update(payloadString).digest('hex');
  const signatureString = `${method}\n${url}\n${queryParam}\n${hashedPayload}\n${timestamp}`;
  const sign = crypto.createHmac('sha512', apiSecret).update(signatureString).digest('hex');
  
  return {
    Timestamp: timestamp,
    SIGN: sign,
  };
}

async function makeGateIORequest(method, url, queryParam = '', payloadString = '') {
  const signHeaders = createGateIOSignature(method, url, queryParam, payloadString, GATEIO_API_SECRET);
  
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'KEY': GATEIO_API_KEY,
    'Timestamp': signHeaders.Timestamp,
    'SIGN': signHeaders.SIGN
  };

  const fullUrl = `https://api.gateio.ws${url}${queryParam ? `?${queryParam}` : ''}`;
  
  const response = await fetch(fullUrl, {
    method,
    headers,
    body: payloadString || undefined
  });
  
  const responseText = await response.text();
  
  if (!response.ok) {
    throw new Error(`API Error (${response.status}): ${responseText}`);
  }
  
  return responseText ? JSON.parse(responseText) : null;
}

async function testPositionSafetyChecker() {
  console.log('=== Position Safety Checker Test ===\n');
  
  try {
    // 1. Fetch all open USDT positions
    console.log('1. Fetching USDT positions...');
    const usdtPositions = await makeGateIORequest('GET', '/api/v4/futures/usdt/positions');
    const openUsdtPositions = usdtPositions.filter(pos => parseFloat(pos.size) !== 0);
    console.log(`Found ${openUsdtPositions.length} open USDT positions`);
    
    if (openUsdtPositions.length > 0) {
      console.log('Open USDT Positions:');
      openUsdtPositions.forEach((pos, index) => {
        console.log(`  ${index + 1}. ${pos.contract}: Size=${pos.size}, Value=${pos.value}, PnL=${pos.unrealised_pnl}`);
      });
    }
    
    // 2. Fetch all open BTC positions  
    console.log('\n2. Fetching BTC positions...');
    let openBtcPositions = [];
    try {
      const btcPositions = await makeGateIORequest('GET', '/api/v4/futures/btc/positions');
      openBtcPositions = btcPositions.filter(pos => parseFloat(pos.size) !== 0);
      console.log(`Found ${openBtcPositions.length} open BTC positions`);
      
      if (openBtcPositions.length > 0) {
        console.log('Open BTC Positions:');
        openBtcPositions.forEach((pos, index) => {
          console.log(`  ${index + 1}. ${pos.contract}: Size=${pos.size}, Value=${pos.value}, PnL=${pos.unrealised_pnl}`);
        });
      }
    } catch (error) {
      console.log(`BTC positions fetch failed: ${error.message} (continuing with USDT only)`);
    }
    
    // 3. Fetch all open conditional orders for USDT
    console.log('\n3. Fetching USDT conditional orders...');
    const usdtConditionalOrders = await makeGateIORequest('GET', '/api/v4/futures/usdt/price_orders', 'status=open');
    console.log(`Found ${usdtConditionalOrders.length} open USDT conditional orders`);
    
    if (usdtConditionalOrders.length > 0) {
      console.log('Open USDT Conditional Orders:');
      usdtConditionalOrders.forEach((order, index) => {
        const contract = order.initial?.contract || 'unknown';
        const size = order.initial?.size || 'unknown';
        console.log(`  ${index + 1}. ${contract}: ID=${order.id}, Type=${order.initial?.is_reduce_only ? 'Reduce-Only' : 'Normal'}, Trigger=${order.trigger.price}, Size=${size}`);
      });
    }
    
    // 4. Fetch all open conditional orders for BTC
    console.log('\n4. Fetching BTC conditional orders...');
    let btcConditionalOrders = [];
    try {
      btcConditionalOrders = await makeGateIORequest('GET', '/api/v4/futures/btc/price_orders', 'status=open');
      console.log(`Found ${btcConditionalOrders.length} open BTC conditional orders`);
      
      if (btcConditionalOrders.length > 0) {
        console.log('Open BTC Conditional Orders:');
        btcConditionalOrders.forEach((order, index) => {
          console.log(`  ${index + 1}. ${order.contract}: ID=${order.id}, Type=${order.is_reduce_only ? 'Reduce-Only' : 'Normal'}, Trigger=${order.trigger.price}, Size=${order.size}`);
        });
      }
    } catch (error) {
      console.log(`BTC conditional orders fetch failed: ${error.message} (continuing with USDT only)`);
    }
    
    // 5. Check position safety - combine all positions and conditional orders
    const allOpenPositions = [...openUsdtPositions, ...openBtcPositions];
    const allConditionalOrders = [...usdtConditionalOrders, ...btcConditionalOrders];
    
    console.log('\n5. Position Safety Analysis:');
    console.log(`Total open positions: ${allOpenPositions.length}`);
    console.log(`Total conditional orders: ${allConditionalOrders.length}`);
    
    const unsafePositions = [];
    
    for (const position of allOpenPositions) {
      const contractOrders = allConditionalOrders.filter(order => order.initial?.contract === position.contract);
      console.log(`\n  Position ${position.contract}:`);
      console.log(`    Size: ${position.size}`);
      console.log(`    Conditional orders: ${contractOrders.length}`);
      
      if (contractOrders.length < 2) {
        console.log(`    ⚠️  UNSAFE: Only ${contractOrders.length} conditional orders (expected 2)`);
        unsafePositions.push(position);
        
        contractOrders.forEach(order => {
          console.log(`      Order ID: ${order.id}, Trigger: ${order.trigger.price}, Size: ${order.initial?.size || 'unknown'}`);
        });
      } else {
        console.log(`    ✅ SAFE: Has ${contractOrders.length} conditional orders`);
      }
    }
    
    if (unsafePositions.length > 0) {
      console.log(`\n⚠️  Found ${unsafePositions.length} unsafe positions without proper conditional orders:`);
      unsafePositions.forEach(pos => {
        console.log(`  - ${pos.contract}: Size=${pos.size}, Value=${pos.value}`);
      });
      
      // 6. Test closing DOGS_USDT position if it exists and is unsafe
      const dogsPosition = unsafePositions.find(pos => pos.contract === 'DOGS_USDT');
      if (dogsPosition) {
        console.log(`\n6. Testing position closure for DOGS_USDT...`);
        console.log(`   Position size: ${dogsPosition.size}`);
        console.log(`   Position value: ${dogsPosition.value}`);
        
        // Determine if we're long or short
        const isLong = parseFloat(dogsPosition.size) > 0;
        const side = isLong ? 'sell' : 'buy'; // Opposite side to close
        const size = Math.abs(parseFloat(dogsPosition.size)).toString();
        
        console.log(`   Closing ${isLong ? 'LONG' : 'SHORT'} position with ${side} order of size ${size}`);
        
        const closeOrder = {
          contract: 'DOGS_USDT',
          size: size,
          price: '0', // Market order
          tif: 'ioc', // Immediate or Cancel
          text: 'safety_close',
          reduce_only: true // This ensures we're only closing existing position
        };
        
        // Add the side based on position direction
        if (isLong) {
          closeOrder.size = `-${size}`; // Negative size for sell
        }
        
        console.log(`   Close order details:`, closeOrder);
        
        // Uncomment the next line to actually close the position
        // const closeResult = await makeGateIORequest('POST', '/api/v4/futures/usdt/orders', '', JSON.stringify(closeOrder));
        // console.log(`   Close result:`, closeResult);
        
        console.log(`   ⚠️  Position closure test prepared but not executed (uncomment to actually close)`);
      } else {
        console.log(`\n6. DOGS_USDT position not found in unsafe positions list`);
      }
    } else {
      console.log(`\n✅ All positions are safe - each has proper conditional orders`);
    }
    
  } catch (error) {
    console.error('Error during position safety check:', error);
  }
}

testPositionSafetyChecker().catch(console.error);
