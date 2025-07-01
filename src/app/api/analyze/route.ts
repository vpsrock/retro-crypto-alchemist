import { NextRequest, NextResponse } from 'next/server';
import { analyzeTradeRecommendations } from '@/ai/flows/analyze-trade-recommendations';

export async function POST(request: NextRequest) {
  let data: any;
  try {
    data = await request.json();
    console.log(`[${new Date().toISOString()}] API: Starting analysis for ${data.contract}`);
    
    const result = await analyzeTradeRecommendations(data);
    
    if (!result) {
      return NextResponse.json(
        { error: 'Analysis failed to return a result. The contract may not exist or the API is unavailable.' },
        { status: 500 }
      );
    }
    
    console.log(`[${new Date().toISOString()}] API: Analysis completed for ${data.contract} (Score: ${result.confidence_score}%)`);
    
    // Include verbose details for UI logging
    return NextResponse.json({ 
      data: result,
      verboseDetails: {
        technicalAnalysis: {
          rsi: result.rsi_14,
          macd: result.macd,
          macdSignal: result.macdsignal,
          bollingerUpper: result.bollinger_upper,
          bollingerLower: result.bollinger_lower,
          atr: result.atr_14,
          stochK: result.stoch_k,
          stochD: result.stoch_d,
          ema12: result.ema_12,
          ema26: result.ema_26,
          obv: result.obv,
          currentPrice: result.current_price,
          fundingRate: result.funding_rate,
          volume24h: result.volume_24h_usd,
          openInterest: result.open_interest_contracts
        },
        aiPrompt: result.prompt,
        aiResponse: result.rawResponse,
        analysisPayload: result.analysisPayload
      }
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] API: Analysis error for ${data?.contract || 'unknown'}:`, error);
    return NextResponse.json(
      { error: `Analysis failed: ${error.message || error.toString()}` },
      { status: 500 }
    );
  }
}
