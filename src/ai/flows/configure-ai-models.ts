'use server';

/**
 * @fileOverview A flow for configuring AI models for trade analysis.
 *
 * - configureAIModels - A function that allows users to select and configure different AI models for trade analysis.
 * - ConfigureAIModelsInput - The input type for the configureAIModels function.
 * - ConfigureAIModelsOutput - The return type for the configureAIModels function.
 */

import {ai} from '@/ai/genkit';
import {
  ConfigureAIModelsInputSchema,
  ConfigureAIModelsOutputSchema,
} from '@/lib/schemas';
import type {
  ConfigureAIModelsInput,
  ConfigureAIModelsOutput,
  AiModelConfig,
} from '@/lib/schemas';

export type { ConfigureAIModelsInput, ConfigureAIModelsOutput, AiModelConfig };

export async function configureAIModels(input: ConfigureAIModelsInput): Promise<ConfigureAIModelsOutput> {
  return configureAIModelsFlow(input);
}

const configureAIModelsFlow = ai.defineFlow(
  {
    name: 'configureAIModelsFlow',
    inputSchema: ConfigureAIModelsInputSchema,
    outputSchema: ConfigureAIModelsOutputSchema,
  },
  async input => {
    // For now, just return the input. In the future, we can add validation or other logic here.
    return {configuredModels: input};
  }
);
