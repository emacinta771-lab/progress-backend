const { Pool } = require('pg');
require('dotenv').config();

// ==========================================
// CONFIGURATION
// ==========================================
const isNeonDB = !!process.env.NEON_DATABASE_URL;
const connectionString = isNeonDB ? process.env.NEON_DATABASE_URL : process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ No database connection string found!');
  console.error('   Please set NEON_DATABASE_URL or DATABASE_URL in .env');
  console.error('   Example: NEON_DATABASE_URL=postgresql://user:pass@host/db?sslmode=require');
  process.exit(1);
}

// ==========================================
// CREATE POOL
// ==========================================
const pool = new Pool({
  connectionString: connectionString,
  ssl: isNeonDB ? {
    require: true,
    rejectUnauthorized: false
  } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20, // Maximum number of clients in the pool
});

// ==========================================
// TEST CONNECTION
// ==========================================
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:');
    console.error('   ', err.message);
    console.error('   Connection string:', connectionString.replace(/:[^:]*@/, ':****@'));
    console.error('   Please check your database credentials');
    process.exit(1);
  } else {
    console.log(`✅ Connected to ${isNeonDB ? 'NeonDB' : 'PostgreSQL'} successfully`);
    
    // Get database info
    client.query('SELECT version() as version, NOW() as time')
      .then((result) => {
        console.log(`📦 PostgreSQL version: ${result.rows[0].version.split(',')[0]}`);
        console.log(`🕐 Server time: ${result.rows[0].time}`);
        
        return client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('students', 'users', 'payments')
        `);
      })
      .then((result) => {
        const tables = result.rows.map(r => r.table_name);
        console.log('📊 Tables found:', tables.join(', ') || 'None');
        
        if (tables.length === 0) {
          console.log('⚠️ No tables found. Please run the SQL schema.');
        }

        return Promise.all([
          client.query(`
            CREATE TABLE IF NOT EXISTS users (
              id SERIAL PRIMARY KEY,
              username VARCHAR(50) UNIQUE NOT NULL,
              email VARCHAR(200) UNIQUE NOT NULL,
              password_hash VARCHAR(255) NOT NULL,
              first_name VARCHAR(100) NOT NULL,
              last_name VARCHAR(100) NOT NULL,
              role VARCHAR(20) NOT NULL DEFAULT 'teacher',
              is_active BOOLEAN DEFAULT TRUE,
              is_student BOOLEAN DEFAULT FALSE,
              student_id VARCHAR(100),
              phone VARCHAR(50),
              is_parent BOOLEAN DEFAULT FALSE,
              parent_id INTEGER,
              last_login TIMESTAMP,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `),
          client.query(`
            CREATE TABLE IF NOT EXISTS students (
              id SERIAL PRIMARY KEY,
              student_code VARCHAR(100) UNIQUE,
              student_id VARCHAR(100) UNIQUE,
              first_name VARCHAR(100),
              last_name VARCHAR(100),
              current_standard INTEGER,
              current_class VARCHAR(50),
              academic_year VARCHAR(50),
              enrollment_status VARCHAR(50) DEFAULT 'Active',
              user_id INTEGER,
              parent_email VARCHAR(255),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `),
          client.query(`
            CREATE TABLE IF NOT EXISTS student_credentials (
              id SERIAL PRIMARY KEY,
              student_id VARCHAR(100) UNIQUE,
              student_code VARCHAR(100),
              student_name VARCHAR(255),
              username VARCHAR(100) UNIQUE,
              email VARCHAR(255) UNIQUE,
              password_hash VARCHAR(255),
              password_plain VARCHAR(255),
              status VARCHAR(50) DEFAULT 'Active',
              created_by INTEGER,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              last_login TIMESTAMP
            )
          `),
          client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_student BOOLEAN DEFAULT FALSE`),
          client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(100)`),
          client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`),
          client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_parent BOOLEAN DEFAULT FALSE`),
          client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id INTEGER`),
          client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id INTEGER`),
          client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email VARCHAR(255)`)
        ]);
      })
      .then(() => {
        console.log('✅ Auth schema ensured successfully');
        release();
      })
      .catch((err) => {
        console.error('❌ Error checking tables:', err.message);
        release();
      });
  }
});

// ==========================================
// POOL EVENT HANDLERS
// ==========================================
pool.on('connect', () => {
  console.log('🔌 New database connection established');
});

pool.on('acquire', () => {
  // console.log('🔍 Client acquired from pool');
});

pool.on('remove', () => {
  // console.log('🗑️ Client removed from pool');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err.message);
  if (err.code === 'ECONNRESET') {
    console.error('   Connection was reset by the database server');
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Execute query with error handling
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`📊 Query executed in ${duration}ms`);
    return res;
  } catch (error) {
    console.error('❌ Query error:', error.message);
    throw error;
  }
};

// Get client for transactions
const getClient = async () => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;
  
  // Set timeout for queries
  const timeout = setTimeout(() => {
    console.error('⚠️ Query timeout - client may be stuck');
  }, 30000);
  
  client.query = (...args) => {
    clearTimeout(timeout);
    return query.apply(client, args);
  };
  
  client.release = () => {
    clearTimeout(timeout);
    release.apply(client);
  };
  
  return client;
};

// Check if a table exists
const tableExists = async (tableName) => {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    )
  `, [tableName]);
  return result.rows[0].exists;
};

// Get table row count
const getTableCount = async (tableName) => {
  try {
    const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    return parseInt(result.rows[0].count);
  } catch (error) {
    return 0;
  }
};

// ==========================================
// EXPORT
// ==========================================
module.exports = {
  pool,
  query,
  getClient,
  tableExists,
  getTableCount,
  // Direct access to pool methods
  connect: pool.connect.bind(pool),
  end: pool.end.bind(pool),
};