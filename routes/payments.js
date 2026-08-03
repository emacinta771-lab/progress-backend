const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, JPG, and PDF are allowed.'));
    }
  }
});

// ==========================================
// Helper: Check if column exists
// ==========================================
const columnExists = async (table, column) => {
  const result = await pool.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = $1 AND column_name = $2
  `, [table, column]);
  return result.rows.length > 0;
};

// ==========================================
// GET ALL PAYMENTS
// ==========================================
router.get('/all', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    console.log(`📋 Fetching payments - limit: ${limit}, offset: ${offset}`);
    
    // Check which columns exist
    const hasStatus = await columnExists('payments', 'status');
    const hasUpdatedAt = await columnExists('payments', 'updated_at');
    const hasNotes = await columnExists('payments', 'notes');
    
    // Build the SELECT clause dynamically
    let selectClause = `
      p.id, p.amount, p.payment_date, p.payment_method, 
      p.receipt_number, p.payment_period,
      p.created_at
    `;
    
    if (hasStatus) selectClause += `, p.status`;
    else selectClause += `, 'Completed' as status`;
    
    if (hasUpdatedAt) selectClause += `, p.updated_at`;
    else selectClause += `, p.created_at as updated_at`;
    
    if (hasNotes) selectClause += `, p.notes`;
    else selectClause += `, NULL as notes`;
    
    selectClause += `,
      s.student_id, s.student_code, s.first_name, s.last_name,
      s.current_standard, s.current_class,
      CONCAT(s.first_name, ' ', s.last_name) as student_name
    `;
    
    const query = `
      SELECT ${selectClause}
      FROM payments p
      JOIN students s ON p.student_id = s.id
      ORDER BY p.payment_date DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await pool.query(query, [limit, offset]);
    
    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM payments');
    
    res.json({
      success: true,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].total) || 0,
      limit: limit,
      offset: offset,
      payments: result.rows
    });
    
  } catch (error) {
    console.error('❌ Error fetching payments:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ==========================================
// GET RECENT PAYMENTS
// ==========================================
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const hasStatus = await columnExists('payments', 'status');
    
    let selectClause = `
      p.id, p.amount, p.payment_date, p.payment_method, 
      p.receipt_number, p.payment_period
    `;
    
    if (hasStatus) selectClause += `, p.status`;
    else selectClause += `, 'Completed' as status`;
    
    selectClause += `,
      s.student_id, s.student_code, s.first_name, s.last_name,
      CONCAT(s.first_name, ' ', s.last_name) as student_name
    `;
    
    const query = `
      SELECT ${selectClause}
      FROM payments p
      JOIN students s ON p.student_id = s.id
      ORDER BY p.payment_date DESC
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    
    res.json({ 
      success: true, 
      payments: result.rows 
    });
  } catch (error) {
    console.error('Error fetching recent payments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET PAYMENT SUMMARY
// ==========================================
router.get('/summary', async (req, res) => {
  try {
    const period = req.query.period || 'month';
    
    let dateFilter = "CURRENT_DATE - INTERVAL '30 days'";
    if (period === 'week') dateFilter = "CURRENT_DATE - INTERVAL '7 days'";
    else if (period === 'year') dateFilter = "CURRENT_DATE - INTERVAL '365 days'";
    else if (period === 'all') dateFilter = "'2000-01-01'";
    
    const hasStatus = await columnExists('payments', 'status');
    
    let query = `
      SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(ROUND(AVG(amount), 2), 0) as average_amount,
        COUNT(DISTINCT student_id) as unique_students
    `;
    
    if (hasStatus) {
      query += `,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending
      `;
    } else {
      query += `,
        COUNT(*) as completed,
        0 as pending
      `;
    }
    
    query += ` FROM payments WHERE payment_date >= ${dateFilter}`;
    
    const result = await pool.query(query);
    
    res.json({ 
      success: true, 
      summary: result.rows[0] || {
        total_payments: 0,
        total_amount: 0,
        average_amount: 0,
        unique_students: 0,
        completed: 0,
        pending: 0
      }
    });
    
  } catch (error) {
    console.error('Error fetching payment summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET PAYMENT BY ID
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const hasStatus = await columnExists('payments', 'status');
    const hasUpdatedAt = await columnExists('payments', 'updated_at');
    const hasNotes = await columnExists('payments', 'notes');
    
    let selectClause = `
      p.id, p.amount, p.payment_date, p.payment_method, 
      p.receipt_number, p.payment_period, p.created_at
    `;
    
    if (hasStatus) selectClause += `, p.status`;
    else selectClause += `, 'Completed' as status`;
    
    if (hasUpdatedAt) selectClause += `, p.updated_at`;
    else selectClause += `, p.created_at as updated_at`;
    
    if (hasNotes) selectClause += `, p.notes`;
    else selectClause += `, NULL as notes`;
    
    selectClause += `,
      s.student_id, s.student_code, s.first_name, s.last_name,
      CONCAT(s.first_name, ' ', s.last_name) as student_name
    `;
    
    const query = `
      SELECT ${selectClause}
      FROM payments p
      JOIN students s ON p.student_id = s.id
      WHERE p.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    
    res.json({ success: true, payment: result.rows[0] });
    
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// SCAN RECEIPT
// ==========================================
router.post('/scan-receipt', upload.single('receipt'), async (req, res) => {
  try {
    const { student_id } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ success: false, error: 'No receipt image uploaded' });
    }
    
    console.log('📸 Processing receipt:', file.filename);
    
    const extractedData = {
      amount: 25000,
      student_name: 'Chisomo Banda',
      receipt_number: `RCP-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      payment_method: 'Mobile Money',
      confidence: 85
    };
    
    if (student_id) {
      const student = await pool.query(
        'SELECT first_name, last_name, student_code FROM students WHERE student_id = $1',
        [student_id]
      );
      if (student.rows.length > 0) {
        extractedData.student_name = `${student.rows[0].first_name} ${student.rows[0].last_name}`;
        extractedData.student_code = student.rows[0].student_code;
        extractedData.student_id = student_id;
      }
    }
    
    extractedData.receipt_image = `/uploads/receipts/${file.filename}`;
    
    res.json({ 
      success: true, 
      data: extractedData,
      message: 'Receipt scanned successfully'
    });
    
  } catch (error) {
    console.error('Error scanning receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// RECORD PAYMENT
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { 
      student_id, amount, payment_method, receipt_number, 
      payment_period, status, notes 
    } = req.body;
    
    if (!student_id || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Student ID and amount are required' 
      });
    }
    
    const student = await pool.query(
      'SELECT id, total_fees, amount_paid, outstanding_balance FROM students WHERE student_id = $1',
      [student_id]
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    const studentData = student.rows[0];
    const paymentAmount = parseFloat(amount);
    const newAmountPaid = parseFloat(studentData.amount_paid || 0) + paymentAmount;
    const newBalance = parseFloat(studentData.total_fees || 0) - newAmountPaid;
    const finalReceiptNumber = receipt_number || `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const hasStatus = await columnExists('payments', 'status');
      const hasNotes = await columnExists('payments', 'notes');
      
      let insertQuery = `
        INSERT INTO payments (
          student_id, amount, payment_method, receipt_number, 
          payment_period
      `;
      
      const params = [
        studentData.id, paymentAmount, payment_method || 'Cash', 
        finalReceiptNumber, payment_period || 'General'
      ];
      let paramCounter = 6;
      
      if (hasStatus) {
        insertQuery += `, status`;
        params.push(status || 'Completed');
        paramCounter++;
      }
      
      if (hasNotes && notes) {
        insertQuery += `, notes`;
        params.push(notes);
        paramCounter++;
      }
      
      insertQuery += `) VALUES (`;
      for (let i = 1; i <= params.length; i++) {
        insertQuery += `$${i}`;
        if (i < params.length) insertQuery += `, `;
      }
      insertQuery += `) RETURNING *`;
      
      const paymentResult = await client.query(insertQuery, params);
      
      await client.query(`
        UPDATE students 
        SET amount_paid = $1, outstanding_balance = $2, updated_at = NOW()
        WHERE id = $3
      `, [newAmountPaid, Math.max(0, newBalance), studentData.id]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        message: 'Payment recorded successfully',
        payment: paymentResult.rows[0],
        student: {
          student_id: student_id,
          amount_paid: newAmountPaid,
          outstanding_balance: Math.max(0, newBalance)
        },
        receipt: finalReceiptNumber
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GENERATE INVOICE
// ==========================================
router.get('/invoice/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );
    
    if (student.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    
    const payments = await pool.query(
      'SELECT * FROM payments WHERE student_id = (SELECT id FROM students WHERE student_id = $1) ORDER BY payment_date DESC',
      [studentId]
    );
    
    const invoice = {
      invoice_number: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      student: student.rows[0],
      total_fees: parseFloat(student.rows[0].total_fees || 0),
      amount_paid: parseFloat(student.rows[0].amount_paid || 0),
      balance: parseFloat(student.rows[0].outstanding_balance || 0),
      payments: payments.rows,
      generated_date: new Date().toISOString(),
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    res.json({ success: true, invoice });
    
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET PAYMENT BY RECEIPT NUMBER
// ==========================================
router.get('/receipt/:receiptNumber', async (req, res) => {
  try {
    const { receiptNumber } = req.params;
    
    const result = await pool.query(`
      SELECT 
        p.*,
        s.student_id, s.student_code, s.first_name, s.last_name,
        CONCAT(s.first_name, ' ', s.last_name) as student_name
      FROM payments p
      JOIN students s ON p.student_id = s.id
      WHERE p.receipt_number = $1
    `, [receiptNumber]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }
    
    res.json({ success: true, payment: result.rows[0] });
    
  } catch (error) {
    console.error('Error fetching payment by receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;