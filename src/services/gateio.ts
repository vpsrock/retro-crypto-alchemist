// This is a server-side file.
'use server';

import crypto from 'crypto';

const host = "https://api.gateio.ws";
const prefix = "/api/v4";

function genSign(method: string, url: string, queryParam: string, payloadString: string, apiSecret: string): { Timestamp: string; SIGN: string } {
    const timestamp = (new Date().getTime() / 1000).toString();
    const hashedPayload = crypto.createHash('sha512').update(payloadString).digest('hex');
    const signatureString = `${method}\n${url}\n${queryParam}\n${hashedPayload}\n${timestamp}`;
    const sign = crypto.createHmac('sha512', apiSecret).update(signatureString).digest('hex');
    
    return {
        Timestamp: timestamp,
        SIGN: sign,
    };
}

async function makeRequest(
    method: 'GET' | 'POST' | 'DELETE', 
    path: string, 
    queryParams: URLSearchParams, 
    body: object | null,
    apiKey: string,
    apiSecret: string
) {
    const queryString = queryParams.toString();
    const bodyString = body ? JSON.stringify(body) : '';
    
    if (!apiKey || !apiSecret) {
        throw new Error("API key or secret is not provided.");
    }

    const signHeaders = genSign(method, prefix + path, queryString, bodyString, apiSecret);
    
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'KEY': apiKey,
        'Timestamp': signHeaders.Timestamp,
        'SIGN': signHeaders.SIGN,
    };
    
    const url = `${host}${prefix}${path}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
        method,
        headers,
        body: bodyString || undefined,
        cache: 'no-store',
    });
    
    const responseText = await response.text();

    if (!response.ok) {
        let errorBody;
        try {
            errorBody = JSON.parse(responseText);
        } catch (e) {
            errorBody = responseText;
        }
        throw new Error(`Gate.io API Error (${response.status} on ${method} ${path}): ${JSON.stringify(errorBody)}`);
    }
    
    if (response.status === 204 || !responseText) {
        return null;
    }

    // Pre-process the JSON to handle all numeric IDs by converting them to strings
    const safeJsonText = responseText.replace(/"(id|trade_id|user)":\s*(\d+)/g, '"$1": "$2"');
    
    try {
        return JSON.parse(safeJsonText);
    } catch (e: any) {
        console.error("Failed to parse modified JSON, returning original text for error context.", e);
        throw new Error(`JSON parsing error after attempting to fix numeric IDs. Original text: ${responseText}`);
    }
}


// Function to get contract details - this is a public endpoint
export async function getContract(
    settle: 'usdt' | 'btc',
    contract: string
) {
    const path = `/futures/${settle}/contracts/${contract}`;
    const url = `${host}${prefix}${path}`;
    
    // Diagnostic logging as requested
    console.log(`[DIAGNOSTIC] getContract: Fetching URL: ${url}`);
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            cache: 'no-store',
        });

        const responseText = await response.text();
        
        // Always log the raw response to see what the server is actually sending.
        console.log(`[DIAGNOSTIC] getContract: Response status for ${contract}: ${response.status}`);
        console.log(`[DIAGNOSTIC] getContract: Raw response text for ${contract}:`, responseText);

        if (!response.ok) {
            // Throw an error that includes the detailed response body for logging on the frontend.
            throw new Error(`Failed to fetch contract details. Status: ${response.status}. Response: ${responseText}`);
        }

        if (!responseText) {
            throw new Error(`Received empty response body when fetching contract spec for ${contract}`);
        }

        const data = JSON.parse(responseText);
        return data;

    } catch (error: any) {
        console.error(`[DIAGNOSTIC] getContract: CRITICAL FAILURE for ${contract}:`, error);
        // Re-throw the error with a clear message and the underlying cause.
        throw new Error(`Failed during getContract fetch for ${contract}. Details: ${error.message}`);
    }
}

// New function to set leverage
export async function updateLeverage(
    settle: 'usdt' | 'btc',
    contract: string,
    leverage: string, // Leverage is a string in the query
    apiKey: string,
    apiSecret: string
) {
    const params = new URLSearchParams({ leverage });
    return makeRequest('POST', `/futures/${settle}/positions/${contract}/leverage`, params, null, apiKey, apiSecret);
}

// For placing the initial market order
export async function placeFuturesOrder(
    settle: 'usdt' | 'btc', 
    order: any, 
    apiKey: string, 
    apiSecret: string
) {
    return makeRequest('POST', `/futures/${settle}/orders`, new URLSearchParams(), order, apiKey, apiSecret);
}

// For placing take-profit and stop-loss orders
export async function placePriceTriggeredOrder(
    settle: 'usdt' | 'btc',
    order: any, 
    apiKey: string,
    apiSecret: string
) {
    return makeRequest('POST', `/futures/${settle}/price_orders`, new URLSearchParams(), order, apiKey, apiSecret);
}

// For placing a batch of take-profit and stop-loss orders
export async function placeBatchPriceTriggeredOrders(
    settle: 'usdt' | 'btc',
    orders: any[], 
    apiKey: string,
    apiSecret: string
) {
    return makeRequest('POST', `/futures/${settle}/price_orders`, new URLSearchParams(), orders, apiKey, apiSecret);
}

// For listing open TP/SL orders
export async function listPriceTriggeredOrders(
    settle: 'usdt' | 'btc',
    status: 'open' | 'finished',
    apiKey: string,
    apiSecret: string
) {
    const params = new URLSearchParams({ status });
    return makeRequest('GET', `/futures/${settle}/price_orders`, params, null, apiKey, apiSecret);
}

// For cancelling a specific TP/SL order
export async function cancelPriceTriggeredOrder(
    settle: 'usdt' | 'btc',
    orderId: string,
    apiKey: string,
    apiSecret: string
) {
    return makeRequest('DELETE', `/futures/${settle}/price_orders/${orderId}`, new URLSearchParams(), null, apiKey, apiSecret);
}

// For listing open positions
export async function listPositions(
    settle: 'usdt' | 'btc',
    apiKey: string,
    apiSecret: string
) {
    return makeRequest('GET', `/futures/${settle}/positions`, new URLSearchParams(), null, apiKey, apiSecret);
}
