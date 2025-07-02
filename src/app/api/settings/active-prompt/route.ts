import { NextRequest, NextResponse } from 'next/server';
import { initDatabase, getPrompts, getAiModels } from '@/services/database';

export async function GET() {
  try {
    await initDatabase();
    
    // Get all prompts and AI models
    const prompts = await getPrompts();
    const aiModels = await getAiModels();
    
    // Find the first enabled AI model
    const enabledModel = aiModels.find(model => model.enabled);
    
    if (!enabledModel) {
      return NextResponse.json(
        { success: false, error: 'No enabled AI model found' },
        { status: 400 }
      );
    }
    
    // Find appropriate prompt based on model type
    let selectedPrompt = prompts.find(p => 
      (enabledModel.modelType === 'reasoning' && p.name.toLowerCase().includes('reasoning')) ||
      (enabledModel.modelType === 'standard' && p.name.toLowerCase().includes('legacy'))
    );
    
    // Fallback to first prompt if no matching prompt found
    if (!selectedPrompt && prompts.length > 0) {
      selectedPrompt = prompts[0];
    }
    
    if (!selectedPrompt) {
      return NextResponse.json(
        { success: false, error: 'No prompts found' },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      prompt: selectedPrompt.content,
      promptName: selectedPrompt.name,
      modelConfig: enabledModel
    });
  } catch (error) {
    console.error('Error getting active prompt:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get active prompt' },
      { status: 500 }
    );
  }
}
