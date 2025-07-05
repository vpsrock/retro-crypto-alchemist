import { NextRequest, NextResponse } from 'next/server';
import { initDatabase, getAllSettings, saveSetting, getApiKeys, saveApiKeys, getAiModels, saveAiModels, getPrompts, savePrompts, getDiscoveryDefaults, saveDiscoveryDefaults } from '@/services/database';
import '@/lib/server-init'; // Import to trigger auto-initialization

export async function GET() {
  try {
    await initDatabase();
    const settings = await getAllSettings();
    
    return NextResponse.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDatabase();
    const { category, data } = await request.json();
    
    if (!category || !data) {
      return NextResponse.json(
        { success: false, error: 'Category and data are required' },
        { status: 400 }
      );
    }

    // Validate category
    const validCategories = ['api_keys', 'ai_models', 'prompts', 'discovery_defaults'];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { success: false, error: 'Invalid category' },
        { status: 400 }
      );
    }

    await saveSetting(category, data);
    
    return NextResponse.json({
      success: true,
      message: `${category} saved successfully`
    });
  } catch (error) {
    console.error('Error saving setting:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save setting' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await initDatabase();
    const { type, data } = await request.json();
    
    // Handle different types of updates
    switch (type) {
      case 'api_keys':
        await saveApiKeys(data);
        break;
      case 'ai_models':
        await saveAiModels(data);
        break;
      case 'prompts':
        await savePrompts(data);
        break;
      case 'discovery_defaults':
        await saveDiscoveryDefaults(data);
        break;
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid type' },
          { status: 400 }
        );
    }
    
    return NextResponse.json({
      success: true,
      message: `${type} updated successfully`
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update setting' },
      { status: 500 }
    );
  }
}
