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

async function testGateIOPositions() {
  console.log('=== Testing Gate.io Positions API ===\n');
  
  const method = 'GET';
  const url = '/api/v4/futures/usdt/positions';
  const queryParam = '';
  const payloadString = '';
  
  const signHeaders = createGateIOSignature(method, url, queryParam, payloadString, GATEIO_API_SECRET);
  
  console.log('API Request Details:');
  console.log(`URL: https://api.gateio.ws${url}`);
  console.log(`Method: ${method}`);
  console.log(`Timestamp: ${signHeaders.Timestamp}`);
  console.log(`Signature: ${signHeaders.SIGN}\n`);
  
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'KEY': GATEIO_API_KEY,
    'Timestamp': signHeaders.Timestamp,
    'SIGN': signHeaders.SIGN
  };
  
  try {
    console.log('Making API request...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(`https://api.gateio.ws${url}`, {
      method,
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log(`Response Headers:`, Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log(`\nRaw Response:`);
    console.log(responseText);
    
    try {
      const data = JSON.parse(responseText);
      console.log(`\nParsed Response:`);
      console.log(JSON.stringify(data, null, 2));
      
      if (Array.isArray(data)) {
        console.log(`\n=== POSITIONS ANALYSIS ===`);
        console.log(`Total positions returned: ${data.length}`);
        
        const openPositions = data.filter(pos => parseFloat(pos.size) !== 0);
        console.log(`Open positions (non-zero size): ${openPositions.length}`);
        
        if (openPositions.length > 0) {
          console.log(`\nOpen Positions Details:`);
          openPositions.forEach((pos, index) => {
            console.log(`${index + 1}. Contract: ${pos.contract}`);
            console.log(`   Size: ${pos.size}`);
            console.log(`   Value: ${pos.value}`);
            console.log(`   Entry Price: ${pos.entry_price}`);
            console.log(`   Mark Price: ${pos.mark_price}`);
            console.log(`   PnL: ${pos.unrealised_pnl}`);
            console.log(`   Side: ${parseFloat(pos.size) > 0 ? 'LONG' : 'SHORT'}`);
            console.log('');
          });
        }
      }
      
    } catch (parseError) {
      console.log(`\nJSON Parse Error: ${parseError.message}`);
    }
    
  } catch (error) {
    console.error(`\nAPI Error: ${error.message}`);
  }
}

// Also test BTC positions
async function testBTCPositions() {
  console.log('\n=== Testing Gate.io BTC Positions API ===\n');
  
  const method = 'GET';
  const url = '/api/v4/futures/btc/positions';
  const queryParam = '';
  const payloadString = '';
  
  const signHeaders = createGateIOSignature(method, url, queryParam, payloadString, GATEIO_API_SECRET);
  
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'KEY': GATEIO_API_KEY,
    'Timestamp': signHeaders.Timestamp,
    'SIGN': signHeaders.SIGN
  };
  
  try {
    const response = await fetch(`https://api.gateio.ws${url}`, {
      method,
      headers
    });
    
    console.log(`BTC Positions Response Status: ${response.status}`);
    const responseText = await response.text();
    console.log(`BTC Positions Raw Response:`);
    console.log(responseText);
    
    const data = JSON.parse(responseText);
    if (Array.isArray(data)) {
      const openBTCPositions = data.filter(pos => parseFloat(pos.size) !== 0);
      console.log(`BTC Open positions: ${openBTCPositions.length}`);
    }
    
  } catch (error) {
    console.error(`\nBTC API Error: ${error.message}`);
  }
}

async function runTests() {
  await testGateIOPositions();
  await testBTCPositions();
}

runTests().catch(console.error);
