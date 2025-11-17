// utils/logger.js - Smart Logger with Environment Control

class Logger {
  constructor() {
    // Check environment
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    this.debugMode = process.env.DEBUG_LOGS === 'true';
    this.logLevel = process.env.LOG_LEVEL || 'info'; // 'debug', 'info', 'warn', 'error'
  }

  // Log levels priority: debug < info < warn < error
  shouldLog(level) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  debug(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('🔍 [DEBUG]', ...args);
    }
  }

  info(...args) {
    if (this.shouldLog('info')) {
      console.log('ℹ️  [INFO]', ...args);
    }
  }

  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn('⚠️  [WARN]', ...args);
    }
  }

  error(...args) {
    if (this.shouldLog('error')) {
      console.error('❌ [ERROR]', ...args);
    }
  }

  success(...args) {
    if (this.shouldLog('info')) {
      console.log('✅ [SUCCESS]', ...args);
    }
  }

  // Redis specific logs
  redis(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('🔴 [REDIS]', ...args);
    }
  }

  // Queue specific logs
  queue(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('⚡ [QUEUE]', ...args);
    }
  }

  // SMS specific logs
  sms(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('📨 [SMS]', ...args);
    }
  }

  // Import specific logs
  import(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('📊 [IMPORT]', ...args);
    }
  }

  // Webhook logs
  webhook(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('🔔 [WEBHOOK]', ...args);
    }
  }

  // Database logs
  db(...args) {
    if (this.isDevelopment || this.debugMode) {
      console.log('💾 [DATABASE]', ...args);
    }
  }

  // Always log (ignores all filters) - use sparingly
  always(...args) {
    console.log('🚨 [ALWAYS]', ...args);
  }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;