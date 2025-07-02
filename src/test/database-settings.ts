// This is a temporary file to test the database-only settings approach
// TODO: Remove this and update page.tsx properly

export const testDatabaseSettings = async () => {
  try {
    // Test fetching all settings
    const response = await fetch('/api/settings');
    const data = await response.json();
    console.log('Settings loaded from database:', data);
    
    // Test getting active prompt
    const promptResponse = await fetch('/api/settings/active-prompt');
    const promptData = await promptResponse.json();
    console.log('Active prompt:', promptData);
    
    return { success: true, settings: data.settings, activePrompt: promptData };
  } catch (error) {
    console.error('Error testing database settings:', error);
    return { success: false, error };
  }
};
