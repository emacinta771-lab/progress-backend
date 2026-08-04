const [nodeMajor] = process.versions.node.split('.').map(Number);
const REQUIRED_NODE_MAJOR = 20;

if (nodeMajor < REQUIRED_NODE_MAJOR) {
  console.error(`❌ Backend requires Node.js ${REQUIRED_NODE_MAJOR}.0.0 or later. Current version: ${process.version}`);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes that exist
const studentRoutes = require('./routes/students');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');

// New routes
let receiptRoutes, teacherRoutes, attendanceRoutes, gradeRoutes, feeRoutes, reportRoutes, dashboardRoutes, notificationRoutes, credentialsRoutes;

// Try loading receipt routes
try {
  receiptRoutes = require('./routes/receipts');
  console.log('✅ Receipt routes loaded');
} catch (e) {
  console.log('⚠️ Receipts route not found, skipping...');
  receiptRoutes = null;
}

// Try loading credentials routes
try {
  credentialsRoutes = require('./routes/credentials');
  console.log('✅ Credentials routes loaded');
} catch (e) {
  console.log('⚠️ Credentials route not found, skipping...');
  credentialsRoutes = null;
}

try {
  teacherRoutes = require('./routes/teachers');
} catch (e) {
  console.log('⚠️ Teachers route not found, skipping...');
  teacherRoutes = null;
}

try {
  attendanceRoutes = require('./routes/attendance');
} catch (e) {
  console.log('⚠️ Attendance route not found, skipping...');
  attendanceRoutes = null;
}

try {
  gradeRoutes = require('./routes/grades');
} catch (e) {
  console.log('⚠️ Grades route not found, skipping...');
  gradeRoutes = null;
}

try {
  feeRoutes = require('./routes/fees');
} catch (e) {
  console.log('⚠️ Fees route not found, skipping...');
  feeRoutes = null;
}

try {
  reportRoutes = require('./routes/reports');
} catch (e) {
  console.log('⚠️ Reports route not found, skipping...');
  reportRoutes = null;
}

try {
  dashboardRoutes = require('./routes/dashboard');
} catch (e) {
  console.log('⚠️ Dashboard route not found, skipping...');
  dashboardRoutes = null;
}

try {
  notificationRoutes = require('./routes/notifications');
} catch (e) {
  console.log('⚠️ Notifications route not found, skipping...');
  notificationRoutes = null;
}

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// MIDDLEWARE
// ==========================================
// Allowed frontend origins (local dev + deployed Vercel apps)
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://progress-xi-three.vercel.app',
  'https://sms-school.vercel.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g., mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`🚫 Blocked CORS origin: ${origin}`);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================
// LOGGING MIDDLEWARE
// ==========================================
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`📝 ${req.method} ${req.url}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`✅ ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ==========================================
// ROOT ROUTE FOR HEALTH CHECKS (FIX)
// ==========================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Progress Backend API',
    version: '1.0.0',
    endpoints: {
      test: '/api/test',
      health: '/api/health',
      auth: '/api/auth',
      students: '/api/students',
      payments: '/api/payments',
      receipts: '/api/receipts',
      credentials: '/api/credentials'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Handle HEAD requests (used by Render health checks)
app.head('/', (req, res) => {
  res.status(200).end();
});

// ==========================================
// TEST ROUTES
// ==========================================
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ==========================================
// AUTH ROUTES
// ==========================================
app.use('/api/auth', authRoutes);

// ==========================================
// STUDENT ROUTES
// ==========================================
app.use('/api/students', studentRoutes);

// ==========================================
// PAYMENT ROUTES
// ==========================================
app.use('/api/payments', paymentRoutes);

// ==========================================
// RECEIPT ROUTES
// ==========================================
if (receiptRoutes) {
  app.use('/api/receipts', receiptRoutes);
}

// ==========================================
// CREDENTIALS ROUTES
// ==========================================
if (credentialsRoutes) {
  app.use('/api/credentials', credentialsRoutes);
}

// ==========================================
// OPTIONAL ROUTES (if they exist)
// ==========================================
if (teacherRoutes) app.use('/api/teachers', teacherRoutes);
if (attendanceRoutes) app.use('/api/attendance', attendanceRoutes);
if (gradeRoutes) app.use('/api/grades', gradeRoutes);
if (feeRoutes) app.use('/api/fees', feeRoutes);
if (reportRoutes) app.use('/api/reports', reportRoutes);
if (dashboardRoutes) app.use('/api/dashboard', dashboardRoutes);
if (notificationRoutes) app.use('/api/notifications', notificationRoutes);

// ==========================================
// DATABASE CONNECTION CHECK
// ==========================================
const pool = require('./config/database');

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// ==========================================
// CLOUDFLARE R2 STATUS CHECK
// ==========================================
try {
  const { isCloudflareConfigured } = require('./config/cloudflare');
  if (isCloudflareConfigured()) {
    console.log('✅ Cloudflare R2 is configured and ready');
  } else {
    console.log('⚠️ Cloudflare R2 is not fully configured');
    console.log('   Uploaded receipts will be stored locally');
    console.log('   Configure Cloudflare R2 in .env for cloud storage');
  }
} catch (error) {
  console.log('⚠️ Cloudflare R2 module not loaded');
  console.log('   Receipt images will be stored locally');
}

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.url}`
  });
});

// ==========================================
// ERROR HANDLING MIDDLEWARE
// ==========================================
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  console.error('❌ Stack:', err.stack);
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: err.message
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      details: err.message
    });
  }
  
  if (err.code === '23505') { // PostgreSQL unique violation
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
      details: err.detail
    });
  }
  
  if (err.code === '23503') { // PostgreSQL foreign key violation
    return res.status(400).json({
      success: false,
      error: 'Referenced record not found',
      details: err.detail
    });
  }
  
  // Cloudflare R2 specific errors
  if (err.name === 'NoSuchBucket') {
    return res.status(500).json({
      success: false,
      error: 'Storage bucket not found. Please check Cloudflare R2 configuration.'
    });
  }
  
  if (err.name === 'AccessDenied' || err.name === 'InvalidAccessKeyId') {
    return res.status(500).json({
      success: false,
      error: 'Storage access denied. Please check Cloudflare R2 credentials.'
    });
  }
  
  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      code: err.code
    })
  });
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, closing server...');
  pool.end(() => {
    console.log('✅ Database connections closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, closing server...');
  pool.end(() => {
    console.log('✅ Database connections closed');
    process.exit(0);
  });
});

// ==========================================
// START SERVER
// ==========================================
const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('='.repeat(60));
  console.log(`📍 Test API:      http://localhost:${PORT}/api/test`);
  console.log(`📍 Health Check:  http://localhost:${PORT}/api/health`);
  console.log(`📍 Auth Login:    http://localhost:${PORT}/api/auth/login`);
  console.log(`📍 Auth Profile:  http://localhost:${PORT}/api/auth/me`);
  console.log(`📍 Auth Users:    http://localhost:${PORT}/api/auth/users`);
  console.log(`📍 Students:      http://localhost:${PORT}/api/students`);
  console.log(`📍 Payments:      http://localhost:${PORT}/api/payments`);
  if (receiptRoutes) console.log(`📍 Receipts:      http://localhost:${PORT}/api/receipts`);
  if (credentialsRoutes) console.log(`📍 Credentials:   http://localhost:${PORT}/api/credentials`);
  if (teacherRoutes) console.log(`📍 Teachers:      http://localhost:${PORT}/api/teachers`);
  if (attendanceRoutes) console.log(`📍 Attendance:    http://localhost:${PORT}/api/attendance`);
  if (gradeRoutes) console.log(`📍 Grades:        http://localhost:${PORT}/api/grades`);
  if (feeRoutes) console.log(`📍 Fees:          http://localhost:${PORT}/api/fees`);
  if (reportRoutes) console.log(`📍 Reports:       http://localhost:${PORT}/api/reports`);
  if (dashboardRoutes) console.log(`📍 Dashboard:     http://localhost:${PORT}/api/dashboard`);
  if (notificationRoutes) console.log(`📍 Notifications: http://localhost:${PORT}/api/notifications`);
  console.log('='.repeat(60));
  console.log(`✅ Server ready for requests`);
  console.log(`🌍 Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`📦 Database:     NeonDB`);
  console.log(`🔑 JWT Secret:   ${process.env.JWT_SECRET ? '✅ Set' : '❌ Not set'}`);
  
  // Show Cloudflare status
  try {
    const { isCloudflareConfigured } = require('./config/cloudflare');
    console.log(`☁️ Cloudflare R2:   ${isCloudflareConfigured() ? '✅ Configured' : '⚠️ Not configured'}`);
  } catch {
    console.log(`☁️ Cloudflare R2:   ⚠️ Not configured (local storage)`);
  }
  
  console.log('='.repeat(60));
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit the process, just log the error
});

module.exports = { app, server };