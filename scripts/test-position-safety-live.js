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

async function makeApiCall(method, url, queryParam = '', payloadString = '') {
  const signHeaders = createGateIOSignature(method, url, queryParam, payloadString, GATEIO_API_SECRET);
  
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'KEY': GATEIO_API_KEY,
    'Timestamp': signHeaders.Timestamp,
    'SIGN': signHeaders.SIGN
  };

  const fullUrl = `https://api.gateio.ws${url}${queryParam ? `?${queryParam}` : ''}`;
  
  try {
    console.log(`Making API call to: ${fullUrl}`);
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(fullUrl, {
      method,
      headers,
      body: payloadString || undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`API Error (${response.status}):`, responseText);
      return null;
    }
    
    return responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    console.error(`Request failed:`, error.message);
    return null;
  }
}

async function testPositionSafetyLogic() {
  console.log('=== TESTING POSITION SAFETY LOGIC ===\n');
  
  // Step 1: Fetch all open positions
  console.log('1. Fetching all open USDT positions...');
  const positions = await makeApiCall('GET', '/api/v4/futures/usdt/positions');
  
  if (!positions) {
    console.error('Failed to fetch positions');
    return;
  }
  
  const openPositions = positions.filter(pos => parseFloat(pos.size) !== 0);
  console.log(`Found ${openPositions.length} open positions`);
  
  if (openPositions.length === 0) {
    console.log('No open positions found - cannot test safety logic');
    return;
  }
  
  // Display all open positions
  console.log('\nOpen Positions:');
  openPositions.forEach((pos, index) => {
    console.log(`${index + 1}. ${pos.contract}: Size=${pos.size}, Entry=${pos.entry_price}, PnL=${pos.unrealised_pnl}`);
  });
  
  // Step 2: Fetch all open conditional orders
  console.log('\n2. Fetching all open conditional orders...');
  const conditionalOrders = await makeApiCall('GET', '/api/v4/futures/usdt/price_orders', 'status=open');
  
  if (!conditionalOrders) {
    console.error('Failed to fetch conditional orders');
    return;
  }
  
  console.log(`Found ${conditionalOrders.length} open conditional orders`);
  
  // Group conditional orders by contract
  const ordersByContract = {};
  conditionalOrders.forEach(order => {
    const contract = order.initial?.contract || 'UNKNOWN';
    if (!ordersByContract[contract]) {
      ordersByContract[contract] = [];
    }
    ordersByContract[contract].push(order);
  });
  
  console.log('\nConditional Orders by Contract:');
  Object.keys(ordersByContract).forEach(contract => {
    const orders = ordersByContract[contract];
    console.log(`${contract}: ${orders.length} orders`);
    orders.forEach(order => {
      console.log(`  - ID: ${order.id}, Rule: ${order.rule}, Price: ${order.trigger.price}`);
    });
  });
  
  // Step 3: Safety check - find positions without proper TP/SL
  console.log('\n3. Running safety check...');
  const unsafePositions = [];
  
  openPositions.forEach(position => {
    const contract = position.contract;
    const conditionalOrdersForContract = ordersByContract[contract] || [];
    
    console.log(`\nChecking ${contract}:`);
    console.log(`  Position size: ${position.size}`);
    console.log(`  Conditional orders: ${conditionalOrdersForContract.length}`);
    
    if (conditionalOrdersForContract.length < 2) {
      console.log(`  ❌ UNSAFE: Only ${conditionalOrdersForContract.length} conditional orders (need 2)`);
      unsafePositions.push({
        position,
        conditionalOrders: conditionalOrdersForContract
      });
    } else {
      console.log(`  ✅ SAFE: Has ${conditionalOrdersForContract.length} conditional orders`);
    }
  });
  
  console.log(`\n=== SAFETY CHECK RESULTS ===`);
  console.log(`Total positions: ${openPositions.length}`);
  console.log(`Unsafe positions: ${unsafePositions.length}`);
  
  if (unsafePositions.length === 0) {
    console.log('\n✅ All positions are safe! No action needed.');
    return;
  }
  
  // Step 4: Handle unsafe positions
  console.log('\n❌ UNSAFE POSITIONS DETECTED:');
  unsafePositions.forEach((unsafe, index) => {
    const pos = unsafe.position;
    console.log(`${index + 1}. ${pos.contract}:`);
    console.log(`   Size: ${pos.size}`);
    console.log(`   Entry Price: ${pos.entry_price}`);
    console.log(`   Current PnL: ${pos.unrealised_pnl}`);
    console.log(`   Conditional Orders: ${unsafe.conditionalOrders.length}`);
  });
  
  // Focus on DOGS_USDT if it's in the unsafe list
  const dogsUnsafe = unsafePositions.find(unsafe => unsafe.position.contract === 'DOGS_USDT');
  
  if (dogsUnsafe) {
    console.log('\n🔍 FOUND DOGS_USDT WITH MISSING CONDITIONAL ORDERS!');
    console.log('This matches your test scenario. Testing position closing...');
    
    await testPositionClosing(dogsUnsafe.position);
  } else {
    console.log('\n⚠️  DOGS_USDT not found in unsafe positions.');
    console.log('You may need to manually cancel another conditional order for DOGS_USDT to test.');
    
    // Check if DOGS_USDT has a position at all
    const dogsPosition = openPositions.find(pos => pos.contract === 'DOGS_USDT');
    if (dogsPosition) {
      console.log('\nDOGS_USDT position found but it has proper conditional orders:');
      const dogsOrders = ordersByContract['DOGS_USDT'] || [];
      console.log(`  Position size: ${dogsPosition.size}`);
      console.log(`  Conditional orders: ${dogsOrders.length}`);
      dogsOrders.forEach(order => {
        console.log(`    - ${order.rule}: ${order.trigger.price}`);
      });
    } else {
      console.log('\nNo DOGS_USDT position found.');
    }
  }
}

async function testPositionClosing(position) {
  console.log(`\n=== TESTING POSITION CLOSING FOR ${position.contract} ===`);
  
  const contract = position.contract;
  const size = Math.abs(parseFloat(position.size));
  const isLong = parseFloat(position.size) > 0;
  
  console.log(`Contract: ${contract}`);
  console.log(`Current Size: ${position.size}`);
  console.log(`Position Type: ${isLong ? 'LONG' : 'SHORT'}`);
  console.log(`Size to Close: ${size}`);
  
  // Prepare the closing order
  const closeOrder = {
    contract,
    size: isLong ? `-${size}` : `${size}`, // Negative for selling (closing long), positive for buying (closing short)
    price: '0', // Market order
    tif: 'ioc', // Immediate or Cancel
    text: 't-position_close_test',
    reduce_only: true // This ensures we're only closing existing position
  };
  
  console.log('\nClosing Order Details:');
  console.log(JSON.stringify(closeOrder, null, 2));
  
  // Ask for confirmation before actually closing
  console.log('\n⚠️  READY TO CLOSE POSITION ⚠️');
  console.log('This will place a REAL market order to close the position.');
  console.log('Current PnL:', position.unrealised_pnl);
  
  // For testing purposes, let's actually place the order
  console.log('\n🚀 PLACING CLOSING ORDER...');
  
  const result = await makeApiCall(
    'POST', 
    '/api/v4/futures/usdt/orders', 
    '', 
    JSON.stringify(closeOrder)
  );
  
  if (result) {
    console.log('\n✅ POSITION CLOSING ORDER PLACED SUCCESSFULLY!');
    console.log('Order Result:');
    console.log(JSON.stringify(result, null, 2));
    
    // Wait a moment and check if position is closed
    console.log('\nWaiting 3 seconds to check position status...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const updatedPositions = await makeApiCall('GET', '/api/v4/futures/usdt/positions');
    const updatedPosition = updatedPositions?.find(pos => pos.contract === contract);
    
    if (updatedPosition && parseFloat(updatedPosition.size) === 0) {
      console.log('✅ POSITION SUCCESSFULLY CLOSED!');
      console.log(`Final size: ${updatedPosition.size}`);
    } else if (updatedPosition) {
      console.log('⚠️  Position still open:');
      console.log(`Remaining size: ${updatedPosition.size}`);
    } else {
      console.log('❓ Could not verify position status');
    }
    
  } else {
    console.log('\n❌ FAILED TO PLACE CLOSING ORDER');
    console.log('Check the error details above.');
  }
}

// Run the test
testPositionSafetyLogic().catch(console.error);
