# **App Name**: Retro Crypto Alchemist

## Core Features:

- AI Trade Recommendation: Fetch technical indicators using the Gate.io API, then use generative AI to provide trade recommendations (long or short), stop-loss, take-profit values, and confidence scores, based on configurable prompts and models. Use this tool only if it returns a sufficiently high confidence score as defined in the settings.
- Real-time Dashboard: Display real-time technical analysis, trade recommendations, confidence scores, and order status updates in a retro, customizable console-like interface.
- Automated Order Placement: Enable automated order placement based on AI recommendations that meet a configurable confidence threshold.
- Scheduled Analysis: Schedule automated analysis and trading tasks, with options for interval-based or specific time-based execution. Runs trade analyses according to specified configurations.
- AI Model Management: Allow users to select and configure multiple AI models (including those that do and don't use a reasoning model) from various providers and configure API keys. Run analysis concurrently.
- Multithreaded Analysis: Support concurrent technical analysis and order placing for multiple crypto futures contracts to increase speed using multithreading.
- Comprehensive Logging: Maintain detailed logs of all analysis results, trade placements, order updates, and system events with advanced features like prompt and AI model setting edits for auditing, debugging, and performance tracking.

## Style Guidelines:

- Primary color: RGB(153, 255, 153). Light green to invoke the digital aesthetic of older software.
- Background color: RGB(30, 82, 30). A desaturated, darkened shade of the primary to establish a dark color scheme that doesn't fatigue the user.
- Accent color: RGB(255, 153, 153). Pale red, an analogous color to the light green, providing an alternative call to attention without clashing.
- Body and headline font: 'Source Code Pro', a monospace font, gives a distinctively code-focused visual style which recalls programming environments and evokes the software aesthetics of the 2000s.
- Use simple, geometric icons reminiscent of early 2000s software. Favor black-and-white or limited color palettes for a technical, no-frills look.
- Employ a modular, grid-based layout with distinct panels for different functions (e.g., technical analysis, AI recommendations, order management, logs).
- Subtle animations, such as a blinking cursor or a scrolling text effect in the log panel, to mimic the interactivity of vintage console interfaces.