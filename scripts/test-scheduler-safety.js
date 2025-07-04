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
  
  const response = await fetch(`https://api.gateio.ws${url}${queryParam ? `?${queryParam}` : ''}`, {
    method,
    headers,
    body: payloadString || undefined
  });
  
  const responseText = await response.text();
  
  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${responseText}`);
  }
  
  return JSON.parse(responseText);
}

async function performPositionSafetyCheck() {
  console.log('=== Testing Position Safety Check Logic ===\n');
  
  try {
    // Check both USDT and BTC markets
    const markets = ['usdt', 'btc'];
    let totalPositions = 0;
    let totalUnsafePositions = 0;
    
    for (const settle of markets) {
      try {
        console.log(`Checking ${settle.toUpperCase()} positions...`);
        
        // Fetch open positions
        const url = `/api/v4/futures/${settle}/positions`;
        const positions = await makeGateIORequest('GET', url);
        const openPositions = positions.filter(pos => parseFloat(pos.size) !== 0);
        
        if (openPositions.length === 0) {
          console.log(`No open ${settle.toUpperCase()} positions found`);
          continue;
        }
        
        console.log(`Found ${openPositions.length} open ${settle.toUpperCase()} positions`);
        totalPositions += openPositions.length;
        
        // Fetch open conditional orders
        const ordersUrl = `/api/v4/futures/${settle}/price_orders`;
        const conditionalOrders = await makeGateIORequest('GET', ordersUrl, 'status=open');
        
        console.log(`Found ${conditionalOrders.length} open ${settle.toUpperCase()} conditional orders`);
        
        // Group conditional orders by contract
        const ordersByContract = {};
        conditionalOrders.forEach(order => {
          const contract = order.initial?.contract?.trim();
          if (contract) {
            if (!ordersByContract[contract]) {
              ordersByContract[contract] = [];
            }
            ordersByContract[contract].push(order);
          }
        });
        
        // Check each position for safety
        console.log(`\\nSafety Check for ${settle.toUpperCase()} Positions:`);
        const unsafePositions = [];
        
        openPositions.forEach((position, index) => {
          const contract = position.contract;
          const orders = ordersByContract[contract] || [];
          const status = orders.length === 2 ? '✅ SAFE' : '⚠️  UNSAFE';
          
          console.log(`${index + 1}. ${contract}: size=${position.size}, conditional orders=${orders.length}/2 ${status}`);
          
          if (orders.length !== 2) {
            unsafePositions.push({
              contract,
              position,
              orderCount: orders.length,
              settle
            });
          }
        });
        
        totalUnsafePositions += unsafePositions.length;
        
        if (unsafePositions.length > 0) {
          console.log(`\\n🚨 Found ${unsafePositions.length} UNSAFE ${settle.toUpperCase()} positions!`);
          unsafePositions.forEach(unsafe => {
            console.log(`- ${unsafe.contract}: ${unsafe.orderCount}/2 conditional orders`);
          });
          
          console.log(`\\n⚠️  In a real safety check, these positions would be closed!`);
        } else {
          console.log(`\\n✅ All ${settle.toUpperCase()} positions are safe`);
        }
        
      } catch (marketError) {
        console.error(`Error checking ${settle} positions:`, marketError.message);
        if (marketError.message.includes('USER_NOT_FOUND')) {
          console.log(`Note: ${settle.toUpperCase()} futures account not set up`);
        }
      }
    }
    
    // Summary
    console.log(`\\n=== Position Safety Check Summary ===`);
    console.log(`Total positions checked: ${totalPositions}`);
    console.log(`Unsafe positions found: ${totalUnsafePositions}`);
    
    if (totalUnsafePositions === 0) {
      console.log(`✅ All positions are safe!`);
    } else {
      console.log(`⚠️  Safety check would close ${totalUnsafePositions} unsafe positions!`);
    }
    
  } catch (error) {
    console.error('Error during position safety check:', error);
  }
}

performPositionSafetyCheck().catch(console.error);
