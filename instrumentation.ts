/**
 * Next.js instrumentation hook
 * This file is automatically called when the application starts
 */

export async function register() {
  // Only run on Node.js runtime (server-side)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      console.log('🚀 Application starting - initializing scheduler service...');
      
      // Import and initialize the scheduler service
      const schedulerService = (await import('./src/services/scheduler')).default;
      await schedulerService.initialize();
      
      console.log('✅ Scheduler service initialized successfully');
      
      // Setup graceful shutdown handlers
      const gracefulShutdown = async (signal: string) => {
        console.log(`📡 Received ${signal}. Starting graceful shutdown...`);
        try {
          await schedulerService.shutdown();
          console.log('✅ Scheduler service shut down successfully');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      };
      
      // Handle various shutdown signals
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Nodemon restart
      
      // Handle uncaught exceptions and unhandled rejections
      process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        gracefulShutdown('uncaughtException');
      });
      
      process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
        gracefulShutdown('unhandledRejection');
      });
      
    } catch (error) {
      console.error('❌ Failed to initialize scheduler service:', error);
      // Don't crash the application if scheduler fails to initialize
      // The application can still run, but scheduling features won't work
    }
  }
}
