import { config } from 'dotenv';
config();

import '@/ai/flows/configure-ai-models.ts';
import '@/ai/flows/analyze-trade-recommendations.ts';
import '@/ai/flows/discover-contracts.ts';
import '@/ai/flows/trade-management.ts';
