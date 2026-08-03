const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

// ==========================================
// CLOUDFLARE R2 CONFIGURATION
// ==========================================

// Get configuration from environment
const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'school-receipts';

// Validate configuration
const isValid = endpoint && accessKeyId && secretAccessKey;

if (!isValid) {
  console.error('❌ Cloudflare R2 Configuration Error:');
  console.error('   Missing required environment variables:');
  if (!endpoint) console.error('   - CLOUDFLARE_R2_ENDPOINT (e.g., https://abc123.r2.cloudflarestorage.com)');
  if (!accessKeyId) console.error('   - CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!secretAccessKey) console.error('   - CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  console.error('\n   Please add these to your .env file');
  console.error('   Get credentials from: Cloudflare Dashboard → R2 → Manage R2 API Tokens');
}

// Build Cloudflare R2 configuration
const cloudflareConfig = {
  endpoint: endpoint,
  region: 'auto',
  credentials: {
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
  },
  forcePathStyle: true,
  // Add retry and timeout settings
  maxAttempts: 3,
  timeout: 10000,
};

// Create S3 client
let s3Client = null;

if (isValid) {
  try {
    s3Client = new S3Client(cloudflareConfig);
    console.log('✅ Cloudflare R2 client initialized successfully');
    console.log(`   Endpoint: ${endpoint}`);
    console.log(`   Bucket: ${bucketName}`);
  } catch (error) {
    console.error('❌ Error creating Cloudflare R2 client:', error.message);
    s3Client = null;
  }
} else {
  console.warn('⚠️ Cloudflare R2 client not initialized - missing configuration');
}

// Helper function to get public URL for a file
const getPublicUrl = (key) => {
  const baseUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL || 
    `${endpoint}/${bucketName}`;
  return `${baseUrl}/${key}`;
};

// Helper function to check if Cloudflare is configured
const isCloudflareConfigured = () => {
  return s3Client !== null && isValid;
};

// Helper to generate unique filename
const generateFileName = (studentId, originalName) => {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1E9);
  const ext = originalName ? originalName.split('.').pop() : 'jpg';
  return `receipts/${studentId}/${timestamp}-${random}.${ext}`;
};

// Export all functions and variables
module.exports = { 
  s3Client, 
  cloudflareConfig, 
  bucketName,
  getPublicUrl,
  isCloudflareConfigured,
  generateFileName
};