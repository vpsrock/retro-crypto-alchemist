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
  
  console.log(`Making ${method} request to: ${fullUrl}`);
  if (payloadString) {
    console.log(`Payload: ${payloadString}`);
  }
  
  const response = await fetch(fullUrl, {
    method,
    headers,
    body: payloadString || undefined
  });
  
  const responseText = await response.text();
  
  console.log(`Response Status: ${response.status}`);
  console.log(`Response: ${responseText}`);
  
  if (!response.ok) {
    throw new Error(`API Error (${response.status}): ${responseText}`);
  }
  
  return responseText ? JSON.parse(responseText) : null;
}

async function testPositionClosing() {
  console.log('=== Testing Position Closing for DOGS_USDT ===\n');
  
  try {
    // 1. First get current DOGS_USDT position
    console.log('1. Checking current DOGS_USDT position...');
    const positions = await makeGateIORequest('GET', '/api/v4/futures/usdt/positions');
    const dogsPosition = positions.find(pos => pos.contract === 'DOGS_USDT' && parseFloat(pos.size) !== 0);
    
    if (!dogsPosition) {
      console.log('No open DOGS_USDT position found.');
      return;
    }
    
    console.log(`Current DOGS_USDT position:`);
    console.log(`  Size: ${dogsPosition.size}`);
    console.log(`  Value: ${dogsPosition.value}`);
    console.log(`  Entry Price: ${dogsPosition.entry_price}`);
    console.log(`  Mark Price: ${dogsPosition.mark_price}`);
    console.log(`  PnL: ${dogsPosition.unrealised_pnl}`);
    
    const isLong = parseFloat(dogsPosition.size) > 0;
    const positionSize = Math.abs(parseFloat(dogsPosition.size));
    
    console.log(`  Position type: ${isLong ? 'LONG' : 'SHORT'}`);
    console.log(`  Position size (absolute): ${positionSize}`);
    
    // 2. Prepare close order
    console.log('\n2. Preparing close order...');
    
    const closeOrder = {
      contract: 'DOGS_USDT',
      size: isLong ? `-${positionSize}` : `${positionSize}`, // Opposite side to close
      price: '0', // Market order
      tif: 'ioc', // Immediate or Cancel
      text: 'test_close',
      reduce_only: true // This ensures we're only closing existing position
    };
    
    console.log(`Close order details:`);
    console.log(JSON.stringify(closeOrder, null, 2));
    
    // 3. Ask for confirmation before executing
    console.log('\n⚠️  READY TO CLOSE POSITION');
    console.log('This will close your DOGS_USDT position with a market order.');
    console.log('Uncomment the next section to actually execute the close order.');
    
    // UNCOMMENT THIS SECTION TO ACTUALLY CLOSE THE POSITION
    /*
    console.log('\n3. Executing close order...');
    const closeResult = await makeGateIORequest(
      'POST', 
      '/api/v4/futures/usdt/orders', 
      '', 
      JSON.stringify(closeOrder)
    );
    
    console.log('Close order result:', closeResult);
    
    // 4. Verify position is closed
    console.log('\n4. Verifying position closure...');
    const updatedPositions = await makeGateIORequest('GET', '/api/v4/futures/usdt/positions');
    const updatedDogsPosition = updatedPositions.find(pos => pos.contract === 'DOGS_USDT' && parseFloat(pos.size) !== 0);
    
    if (!updatedDogsPosition) {
      console.log('✅ Position successfully closed!');
    } else {
      console.log('⚠️  Position still exists:', updatedDogsPosition);
    }
    */
    
  } catch (error) {
    console.error('Error during position closing test:', error);
  }
}

testPositionClosing().catch(console.error);
