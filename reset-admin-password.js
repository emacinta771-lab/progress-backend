const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('📋 Environment check:');
console.log('   NEON_DATABASE_URL exists?', !!process.env.NEON_DATABASE_URL);

// Use NEON_DATABASE_URL from .env
const connectionString = process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.error('❌ NEON_DATABASE_URL is not set in .env file!');
  process.exit(1);
}

// Database connection using NeonDB
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    require: true,
    rejectUnauthorized: false
  }
});

async function resetAdminPassword() {
  const client = await pool.connect();
  try {
    console.log('🔐 Resetting admin password...');
    console.log('📡 Connecting to NeonDB...');
    
    const password = 'Admin@123';
    const saltRounds = 10;
    
    // Generate a new hash
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log('✅ Generated hash:', hashedPassword.substring(0, 30) + '...');
    
    // Check if users table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ Users table does not exist. Creating it...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(200) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'teacher',
            is_active BOOLEAN DEFAULT TRUE,
            last_login TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ Users table created successfully!');
    }
    
    // Check if admin exists
    const checkResult = await client.query(
      'SELECT id, username FROM users WHERE username = $1',
      ['admin']
    );
    
    let result;
    if (checkResult.rows.length > 0) {
      // Update existing admin
      result = await client.query(
        `UPDATE users 
         SET password_hash = $1, updated_at = NOW()
         WHERE username = 'admin'
         RETURNING id, username, is_active`,
        [hashedPassword]
      );
      console.log('✅ Admin password updated successfully!');
    } else {
      // Create new admin
      result = await client.query(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, username, is_active`,
        ['admin', 'admin@school.com', hashedPassword, 'Admin', 'User', 'admin', true]
      );
      console.log('✅ Admin user created successfully!');
    }
    
    console.log('👤 Admin user:', result.rows[0]);
    
    // Verify the password
    const verifyResult = await client.query(
      'SELECT password_hash FROM users WHERE username = $1',
      ['admin']
    );
    
    const isValid = await bcrypt.compare(password, verifyResult.rows[0].password_hash);
    console.log('🔑 Password verification:', isValid ? '✅ Valid' : '❌ Invalid');
    
    if (isValid) {
      console.log('\n🎉 You can now login with:');
      console.log('   Username: admin');
      console.log('   Password: Admin@123');
    }
    
  } catch (error) {
    console.error('❌ Error resetting admin password:', error);
    console.error('📋 Error details:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the function
resetAdminPassword();