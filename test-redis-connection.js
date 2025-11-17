// test-redis-connection.js
// Run this script to diagnose Redis connection issues
// Usage: node test-redis-connection.js

require('dotenv').config();
const Redis = require('ioredis');

console.log('🔍 Redis Connection Diagnostic Tool\n');
console.log('Environment Variables:');
console.log('  REDIS_HOST:', process.env.REDIS_HOST || 'NOT SET');
console.log('  REDIS_PORT:', process.env.REDIS_PORT || 'NOT SET');
console.log('  REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***SET***' : 'NOT SET');
console.log('  REDIS_USERNAME:', process.env.REDIS_USERNAME || 'NOT SET');
console.log('  REDIS_URL:', process.env.REDIS_URL ? '***SET***' : 'NOT SET');
console.log('  REDIS_TLS:', process.env.REDIS_TLS || 'NOT SET');
console.log('\n');

// Test configurations
const configs = [
  {
    name: 'Local Redis (No Auth)',
    config: {
      host: 'localhost',
      port: 6379,
      lazyConnect: true
    }
  },
  {
    name: 'Using REDIS_HOST/PORT with Password Only',
    config: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true
    },
    skip: !process.env.REDIS_HOST || !process.env.REDIS_PASSWORD
  },
  {
    name: 'Using REDIS_HOST/PORT with Username + Password',
    config: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true
    },
    skip: !process.env.REDIS_HOST || !process.env.REDIS_PASSWORD
  },
  {
    name: 'Using REDIS_HOST/PORT with No Auth',
    config: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      lazyConnect: true
    },
    skip: !process.env.REDIS_HOST
  },
  {
    name: 'Using REDIS_URL',
    config: process.env.REDIS_URL,
    skip: !process.env.REDIS_URL
  }
];

async function testConnection(name, config) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log('   Config:', JSON.stringify(config, null, 2));
  
  const client = new Redis(config);
  
  try {
    await client.connect();
    await client.ping();
    console.log('   ✅ Connection successful!');
    
    // Try to set and get a value
    await client.set('test-key', 'test-value');
    const value = await client.get('test-key');
    console.log(`   ✅ Read/Write successful! (Got: ${value})`);
    await client.del('test-key');
    
    await client.quit();
    return true;
  } catch (error) {
    console.log(`   ❌ Connection failed: ${error.message}`);
    try {
      await client.quit();
    } catch (e) {
      // Ignore quit errors
    }
    return false;
  }
}

async function runDiagnostics() {
  console.log('Starting Redis connection tests...\n');
  console.log('=' . repeat(60));
  
  let successfulConfig = null;
  
  for (const test of configs) {
    if (test.skip) {
      console.log(`\n⏭️  Skipping: ${test.name} (missing required env vars)`);
      continue;
    }
    
    const success = await testConnection(test.name, test.config);
    if (success && !successfulConfig) {
      successfulConfig = test;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 SUMMARY:\n');
  
  if (successfulConfig) {
    console.log('✅ Found working configuration:');
    console.log(`   ${successfulConfig.name}`);
    console.log('\n📝 Recommended .env settings:');
    
    if (successfulConfig.name.includes('Username + Password')) {
      console.log(`
REDIS_HOST=${process.env.REDIS_HOST}
REDIS_PORT=${process.env.REDIS_PORT}
REDIS_USERNAME=${process.env.REDIS_USERNAME || 'default'}
REDIS_PASSWORD=${process.env.REDIS_PASSWORD}
REDIS_TLS=false
      `.trim());
    } else if (successfulConfig.name.includes('Password Only')) {
      console.log(`
REDIS_HOST=${process.env.REDIS_HOST}
REDIS_PORT=${process.env.REDIS_PORT}
REDIS_PASSWORD=${process.env.REDIS_PASSWORD}
REDIS_TLS=false
      `.trim());
    } else if (successfulConfig.name.includes('No Auth')) {
      console.log(`
REDIS_HOST=${process.env.REDIS_HOST || 'localhost'}
REDIS_PORT=${process.env.REDIS_PORT || '6379'}
# No password needed
      `.trim());
    } else if (successfulConfig.name.includes('REDIS_URL')) {
      console.log(`
REDIS_URL=${process.env.REDIS_URL}
      `.trim());
    }
  } else {
    console.log('❌ No working configuration found!');
    console.log('\n🔧 Troubleshooting tips:');
    console.log('   1. Make sure Redis is running');
    console.log('   2. Check if Redis requires authentication');
    console.log('   3. Verify your password is correct');
    console.log('   4. Check if your Redis version supports username+password (Redis 6.0+)');
    console.log('   5. Try connecting with redis-cli to verify credentials:');
    console.log(`      redis-cli -h ${process.env.REDIS_HOST || 'localhost'} -p ${process.env.REDIS_PORT || 6379}`);
    console.log('      Then try: AUTH yourpassword');
    console.log('      Or for Redis 6+: AUTH username password');
  }
  
  console.log('\n');
}

runDiagnostics().catch(console.error);