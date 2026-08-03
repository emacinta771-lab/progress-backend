const { s3Client, bucketName, isCloudflareConfigured } = require('./config/cloudflare');
const { ListBucketsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function testCloudflareConnection() {
  console.log('\n🔍 Testing Cloudflare R2 connection...');
  console.log('='.repeat(50));
  
  // Check if Cloudflare is configured
  if (!isCloudflareConfigured()) {
    console.log('❌ Cloudflare R2 is not configured.');
    console.log('   Please check your .env file for the following variables:');
    console.log('   - CLOUDFLARE_R2_ENDPOINT');
    console.log('   - CLOUDFLARE_R2_ACCESS_KEY_ID');
    console.log('   - CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    console.log('\n   Get credentials from: Cloudflare Dashboard → R2 → Manage R2 API Tokens');
    return;
  }

  console.log('📋 Using endpoint:', process.env.CLOUDFLARE_R2_ENDPOINT);
  console.log('📋 Using bucket:', bucketName);
  console.log('='.repeat(50));

  try {
    // Test 1: List buckets
    console.log('\n📋 Test 1: Listing buckets...');
    const listCommand = new ListBucketsCommand({});
    const response = await s3Client.send(listCommand);
    
    console.log('✅ Successfully connected to Cloudflare R2!');
    
    if (response.Buckets && response.Buckets.length > 0) {
      console.log('📦 Available buckets:', response.Buckets.map(b => b.Name).join(', '));
      
      // Check if our bucket exists
      const bucketExists = response.Buckets.some(b => b.Name === bucketName);
      if (bucketExists) {
        console.log(`✅ Bucket '${bucketName}' exists!`);
      } else {
        console.log(`⚠️ Bucket '${bucketName}' does not exist. Please create it in Cloudflare R2.`);
        console.log(`   Create bucket at: Cloudflare Dashboard → R2 → Create bucket`);
      }
    } else {
      console.log('ℹ️ No buckets found. You need to create a bucket.');
    }

    // Test 2: Upload a test file
    console.log('\n📋 Test 2: Uploading test file...');
    const testKey = `test/connection-test-${Date.now()}.txt`;
    
    const uploadParams = {
      Bucket: bucketName,
      Key: testKey,
      Body: `Cloudflare R2 connection test successful! \nTested at: ${new Date().toISOString()}`,
      ContentType: 'text/plain',
    };
    
    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`✅ Successfully uploaded test file: ${testKey}`);
    console.log(`   File location: ${bucketName}/${testKey}`);
    console.log('🎉 Cloudflare R2 connection is fully working!');
    
  } catch (error) {
    console.error('\n❌ Error connecting to Cloudflare R2:');
    console.error('   Error:', error.message);
    console.error('   Error Code:', error.code || 'N/A');
    
    // Provide specific troubleshooting
    if (error.message.includes('Invalid URL') || error.message.includes('Invalid endpoint')) {
      console.error('\n🔧 Fix: Invalid endpoint URL format.');
      console.error(`   Current endpoint: ${process.env.CLOUDFLARE_R2_ENDPOINT}`);
      console.error('   Should be: https://<account-id>.r2.cloudflarestorage.com');
      console.error('   Example: https://abc123def456.r2.cloudflarestorage.com');
    } else if (error.message.includes('AccessDenied') || error.message.includes('InvalidAccessKeyId')) {
      console.error('\n🔧 Fix: Invalid credentials.');
      console.error('   Check your Access Key ID and Secret Access Key.');
      console.error('   Regenerate credentials at: Cloudflare Dashboard → R2 → Manage R2 API Tokens');
    } else if (error.message.includes('NoSuchBucket')) {
      console.error(`\n🔧 Fix: Bucket '${bucketName}' does not exist.`);
      console.error('   Create it at: Cloudflare Dashboard → R2 → Create bucket');
      console.error('   Or change CLOUDFLARE_R2_BUCKET_NAME in .env to an existing bucket');
    } else if (error.message.includes('Network') || error.message.includes('connect')) {
      console.error('\n🔧 Fix: Network error.');
      console.error('   Check your internet connection');
      console.error('   Check if Cloudflare R2 service is accessible');
      console.error('   Verify your firewall/proxy settings');
    } else if (error.message.includes('SignatureDoesNotMatch')) {
      console.error('\n🔧 Fix: Signature mismatch.');
      console.error('   Your Secret Access Key might be incorrect.');
      console.error('   Regenerate credentials at: Cloudflare Dashboard → R2 → Manage R2 API Tokens');
    } else {
      console.error('\n🔧 Unknown error. Please check:');
      console.error('   1. Your Cloudflare R2 endpoint is correct');
      console.error('   2. Your API credentials have read/write permissions');
      console.error('   3. Your bucket exists and is accessible');
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📝 Troubleshooting Resources:');
  console.log('   - Cloudflare R2 Docs: https://developers.cloudflare.com/r2/');
  console.log('   - Get Account ID: Cloudflare Dashboard → Right sidebar');
  console.log('   - Create API Token: R2 → Manage R2 API Tokens');
  console.log('   - Create Bucket: R2 → Create bucket');
  console.log('='.repeat(50));
}

// Run the test
testCloudflareConnection();