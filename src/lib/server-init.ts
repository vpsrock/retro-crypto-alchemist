// Server-side service initializer - runs once when app starts
import { initializeAllDynamicServices } from '@/services/auto-service-manager';

// This runs on the server when the module is first loaded
let initPromise: Promise<void> | null = null;

export function ensureServicesInitialized(): Promise<void> {
    if (!initPromise) {
        initPromise = initializeAllDynamicServices();
    }
    return initPromise;
}

// Auto-initialize when this module is imported (server-side only)
if (typeof window === 'undefined') {
    console.log('[SERVER-INIT] Triggering auto-initialization of dynamic services...');
    
    // Use setTimeout to avoid blocking the initial import
    setTimeout(async () => {
        try {
            await ensureServicesInitialized();
            console.log('[SERVER-INIT] ✅ Dynamic services auto-initialization completed');
        } catch (error) {
            console.error('[SERVER-INIT] ❌ Auto-initialization failed:', error);
        }
    }, 1000);
}
