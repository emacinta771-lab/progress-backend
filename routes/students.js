const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const pool = require('../config/database');

// ==========================================
// GET ALL STUDENTS
// ==========================================
router.get('/', async (req, res) => {
  try {
    console.log('📋 Fetching all students...');
    const students = await Student.findAll();
    console.log(`✅ Found ${students.length} students`);
    res.json({ 
      success: true,
      count: students.length,
      students 
    });
  } catch (error) {
    console.error('❌ Error fetching students:', error);
    console.error('❌ Error details:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.stack
    });
  }
});

// ==========================================
// GET STUDENT BY CODE (for registration)
// ==========================================
router.get('/code/:studentCode', async (req, res) => {
  try {
    console.log(`🔍 Fetching student by code: ${req.params.studentCode}`);
    
    const result = await pool.query(
      `SELECT student_id, student_code, first_name, last_name, 
              date_of_birth, phone, parent_email, parent_name, 
              current_standard, user_id
       FROM students 
       WHERE student_code = $1 AND enrollment_status = 'Active'`,
      [req.params.studentCode]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found or inactive' 
      });
    }
    
    // Check if student already has a user account
    if (result.rows[0].user_id) {
      return res.status(409).json({
        success: false,
        error: 'This student already has an account. Please login.'
      });
    }
    
    res.json({ 
      success: true, 
      student: result.rows[0] 
    });
  } catch (error) {
    console.error('❌ Error fetching student by code:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENT BY USER ID
// ==========================================
router.get('/user/:userId', async (req, res) => {
  try {
    console.log(`👤 Fetching student for user: ${req.params.userId}`);
    
    const result = await pool.query(
      `SELECT s.*, u.username, u.email as user_email, u.role
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.params.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found for this user' 
      });
    }
    
    res.json({ 
      success: true, 
      student: result.rows[0] 
    });
  } catch (error) {
    console.error('❌ Error fetching student by user:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENT STATISTICS - Enhanced
// ==========================================
router.get('/stats/overview', async (req, res) => {
  try {
    console.log('📊 Fetching statistics...');
    
    const result = await pool.query(`
      SELECT 
        -- Student stats
        COUNT(*) as total_students,
        COUNT(CASE WHEN enrollment_status = 'Active' THEN 1 END) as active_students,
        COUNT(CASE WHEN enrollment_status = 'Graduated' THEN 1 END) as graduated_students,
        COUNT(CASE WHEN enrollment_status = 'Transferred' THEN 1 END) as transferred_students,
        COUNT(CASE WHEN enrollment_status = 'Dropped Out' THEN 1 END) as dropped_out_students,
        
        -- Financial stats
        COUNT(CASE WHEN financial_hold = true THEN 1 END) as financial_holds,
        COALESCE(SUM(outstanding_balance), 0) as total_outstanding_balance,
        COALESCE(SUM(total_fees), 0) as total_fees_collected,
        COALESCE(SUM(amount_paid), 0) as total_amount_paid,
        
        -- Resource stats
        COUNT(CASE WHEN has_uniform = true THEN 1 END) as students_with_uniform,
        COUNT(CASE WHEN has_textbooks = true THEN 1 END) as students_with_textbooks,
        COUNT(CASE WHEN meals_program = 'Full' THEN 1 END) as full_meals,
        
        -- Standard distribution
        COUNT(CASE WHEN current_standard = 1 THEN 1 END) as standard_1,
        COUNT(CASE WHEN current_standard = 2 THEN 1 END) as standard_2,
        COUNT(CASE WHEN current_standard = 3 THEN 1 END) as standard_3,
        COUNT(CASE WHEN current_standard = 4 THEN 1 END) as standard_4,
        COUNT(CASE WHEN current_standard = 5 THEN 1 END) as standard_5,
        COUNT(CASE WHEN current_standard = 6 THEN 1 END) as standard_6,
        COUNT(CASE WHEN current_standard = 7 THEN 1 END) as standard_7,
        COUNT(CASE WHEN current_standard = 8 THEN 1 END) as standard_8,
        
        -- Gender distribution
        COUNT(CASE WHEN gender = 'Male' THEN 1 END) as male_students,
        COUNT(CASE WHEN gender = 'Female' THEN 1 END) as female_students,
        
        -- Attendance stats (from attendance table)
        COALESCE(
          (SELECT COUNT(*) FROM attendance WHERE status = 'Present' AND date >= CURRENT_DATE - INTERVAL '7 days'),
          0
        ) as present_this_week,
        COALESCE(
          (SELECT COUNT(*) FROM attendance WHERE status = 'Absent' AND date >= CURRENT_DATE - INTERVAL '7 days'),
          0
        ) as absent_this_week,
        
        -- Payment stats (from payments table)
        COALESCE(
          (SELECT COUNT(*) FROM payments WHERE payment_date >= CURRENT_DATE - INTERVAL '30 days'),
          0
        ) as payments_this_month,
        COALESCE(
          (SELECT SUM(amount) FROM payments WHERE payment_date >= CURRENT_DATE - INTERVAL '30 days'),
          0
        ) as total_payments_this_month,
        
        -- Teacher stats (from teachers table)
        COALESCE(
          (SELECT COUNT(*) FROM teachers WHERE is_active = true),
          0
        ) as active_teachers,
        
        -- Students without accounts
        COUNT(CASE WHEN user_id IS NULL THEN 1 END) as students_without_accounts
        
      FROM students
    `);
    
    const stats = result.rows[0];
    console.log('✅ Stats fetched:', stats);
    
    res.json({ 
      success: true, 
      stats: {
        total_students: parseInt(stats.total_students) || 0,
        active_students: parseInt(stats.active_students) || 0,
        graduated_students: parseInt(stats.graduated_students) || 0,
        transferred_students: parseInt(stats.transferred_students) || 0,
        dropped_out_students: parseInt(stats.dropped_out_students) || 0,
        financial_holds: parseInt(stats.financial_holds) || 0,
        total_outstanding_balance: parseFloat(stats.total_outstanding_balance) || 0,
        total_fees_collected: parseFloat(stats.total_fees_collected) || 0,
        total_amount_paid: parseFloat(stats.total_amount_paid) || 0,
        students_with_uniform: parseInt(stats.students_with_uniform) || 0,
        students_with_textbooks: parseInt(stats.students_with_textbooks) || 0,
        full_meals: parseInt(stats.full_meals) || 0,
        standard_1: parseInt(stats.standard_1) || 0,
        standard_2: parseInt(stats.standard_2) || 0,
        standard_3: parseInt(stats.standard_3) || 0,
        standard_4: parseInt(stats.standard_4) || 0,
        standard_5: parseInt(stats.standard_5) || 0,
        standard_6: parseInt(stats.standard_6) || 0,
        standard_7: parseInt(stats.standard_7) || 0,
        standard_8: parseInt(stats.standard_8) || 0,
        male_students: parseInt(stats.male_students) || 0,
        female_students: parseInt(stats.female_students) || 0,
        present_this_week: parseInt(stats.present_this_week) || 0,
        absent_this_week: parseInt(stats.absent_this_week) || 0,
        payments_this_month: parseInt(stats.payments_this_month) || 0,
        total_payments_this_month: parseFloat(stats.total_payments_this_month) || 0,
        active_teachers: parseInt(stats.active_teachers) || 0,
        students_without_accounts: parseInt(stats.students_without_accounts) || 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    console.error('❌ Error details:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.stack
    });
  }
});

// ==========================================
// GET STUDENTS WITH OUTSTANDING FEES
// ==========================================
router.get('/outstanding-fees', async (req, res) => {
  try {
    console.log('💰 Fetching students with outstanding fees...');
    
    const result = await pool.query(`
      SELECT 
        id, student_id, student_code, first_name, last_name,
        current_standard, current_class, parent_name, parent_phone,
        outstanding_balance, total_fees, amount_paid,
        financial_hold, user_id
      FROM students 
      WHERE outstanding_balance > 0 
      ORDER BY outstanding_balance DESC
    `);
    
    res.json({ 
      success: true, 
      count: result.rows.length,
      students: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching outstanding fees:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET ALL PAYMENTS (for accountant)
// ==========================================
router.get('/payments/all', async (req, res) => {
  try {
    console.log('📋 Fetching all payments...');
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const validLimit = Math.min(Math.max(limit, 1), 100);
    const validOffset = Math.max(offset, 0);
    
    const result = await pool.query(`
      SELECT 
        p.id, p.amount, p.payment_date, p.payment_method, 
        p.receipt_number, p.payment_period, p.status, p.notes,
        s.student_id, s.student_code, s.first_name, s.last_name,
        s.current_standard
      FROM payments p
      JOIN students s ON p.student_id = s.id
      ORDER BY p.payment_date DESC
      LIMIT $1 OFFSET $2
    `, [validLimit, validOffset]);
    
    const countResult = await pool.query('SELECT COUNT(*) as total FROM payments');
    
    res.json({ 
      success: true, 
      count: result.rows.length,
      total: parseInt(countResult.rows[0].total) || 0,
      limit: validLimit,
      offset: validOffset,
      payments: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching payments:', error);
    console.error('❌ Error details:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET PAYMENT SUMMARY (by period)
// ==========================================
router.get('/payments/summary', async (req, res) => {
  try {
    console.log('📊 Fetching payment summary...');
    
    const result = await pool.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', payment_date), 'YYYY-MM') as month,
        COUNT(*) as payment_count,
        SUM(amount) as total_amount,
        ROUND(AVG(amount), 2) as average_amount,
        COUNT(DISTINCT student_id) as unique_students
      FROM payments
      WHERE payment_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', payment_date)
      ORDER BY month DESC
    `);
    
    res.json({ 
      success: true, 
      summary: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching payment summary:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET PAYMENT HISTORY FOR STUDENT
// ==========================================
router.get('/:studentId/payments', async (req, res) => {
  try {
    console.log(`📋 Fetching payment history for ${req.params.studentId}`);
    
    const result = await pool.query(`
      SELECT 
        p.id, p.amount, p.payment_date, p.payment_method, 
        p.receipt_number, p.payment_period, p.status, p.notes
      FROM payments p
      JOIN students s ON p.student_id = s.id
      WHERE s.student_id = $1
      ORDER BY p.payment_date DESC
    `, [req.params.studentId]);
    
    const student = await pool.query(
      'SELECT student_id, student_code, first_name, last_name, total_fees, amount_paid, outstanding_balance FROM students WHERE student_id = $1',
      [req.params.studentId]
    );
    
    res.json({ 
      success: true, 
      student: student.rows[0] || null,
      count: result.rows.length,
      payments: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching payment history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENTS BY STANDARD
// ==========================================
router.get('/standard/:standard', async (req, res) => {
  try {
    console.log(`📋 Fetching students in standard ${req.params.standard}`);
    
    const result = await pool.query(
      `SELECT * FROM students 
       WHERE current_standard = $1 AND enrollment_status = 'Active' 
       ORDER BY first_name`,
      [parseInt(req.params.standard)]
    );
    
    res.json({ 
      success: true, 
      count: result.rows.length,
      students: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching students by standard:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENT BY ID
// ==========================================
router.get('/:studentId', async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    res.json({ success: true, student });
  } catch (error) {
    console.error('❌ Error fetching student:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// SEARCH STUDENTS
// ==========================================
router.get('/search/:query', async (req, res) => {
  try {
    console.log(`🔍 Searching for: ${req.params.query}`);
    const students = await Student.search(req.params.query);
    res.json({ 
      success: true, 
      count: students.length,
      students 
    });
  } catch (error) {
    console.error('❌ Error searching students:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// CREATE STUDENT
// ==========================================
router.post('/', async (req, res) => {
  try {
    console.log('📝 Creating student...');
    console.log('📝 Data:', req.body);
    
    const student = await Student.create(req.body);
    console.log('✅ Student created:', student);
    
    res.status(201).json({ 
      success: true, 
      message: 'Student created successfully',
      student 
    });
  } catch (error) {
    console.error('❌ Error creating student:', error);
    console.error('❌ Error details:', error.stack);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET FEE STATUS
// ==========================================
router.get('/:studentId/fees', async (req, res) => {
  try {
    const feeStatus = await Student.getFeeStatus(req.params.studentId);
    if (!feeStatus) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    res.json({ success: true, feeStatus });
  } catch (error) {
    console.error('❌ Error fetching fee status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// RECORD PAYMENT
// ==========================================
router.post('/:studentId/payments', async (req, res) => {
  try {
    console.log(`💰 Recording payment for ${req.params.studentId}`);
    console.log('💰 Payment data:', req.body);
    
    const student = await Student.recordPayment(req.params.studentId, req.body);
    res.json({ 
      success: true, 
      message: 'Payment recorded successfully',
      student,
      receipt: req.body.receipt_number || `RCP-${Date.now()}`
    });
  } catch (error) {
    console.error('❌ Error recording payment:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// UPDATE STUDENT FEES ONLY
// ==========================================
router.put('/:studentId/fees', async (req, res) => {
  try {
    console.log(`💰 Updating fees for student ${req.params.studentId}`);
    
    const { total_fees, amount_paid, outstanding_balance, fee_payment_plan, scholarship_type, financial_hold, notes } = req.body;
    
    const result = await pool.query(
      `UPDATE students 
       SET total_fees = COALESCE($1, total_fees),
           amount_paid = COALESCE($2, amount_paid),
           outstanding_balance = COALESCE($3, outstanding_balance),
           fee_payment_plan = COALESCE($4, fee_payment_plan),
           scholarship_type = COALESCE($5, scholarship_type),
           financial_hold = COALESCE($6, financial_hold),
           notes = COALESCE($7, notes),
           updated_at = NOW()
       WHERE student_id = $8
       RETURNING *`,
      [total_fees, amount_paid, outstanding_balance, fee_payment_plan, scholarship_type, financial_hold, notes, req.params.studentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Fees updated successfully',
      student: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error updating fees:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// UPDATE STUDENT
// ==========================================
router.put('/:studentId', async (req, res) => {
  try {
    console.log(`✏️ Updating student ${req.params.studentId}`);
    console.log('✏️ Update data:', req.body);
    
    const student = await Student.update(req.params.studentId, req.body);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    res.json({ 
      success: true, 
      message: 'Student updated successfully',
      student 
    });
  } catch (error) {
    console.error('❌ Error updating student:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// DELETE STUDENT
// ==========================================
router.delete('/:studentId', async (req, res) => {
  try {
    console.log(`🗑️ Deleting student ${req.params.studentId}`);
    
    const student = await Student.delete(req.params.studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found' 
      });
    }
    res.json({ 
      success: true, 
      message: `Student ${req.params.studentId} deleted successfully` 
    });
  } catch (error) {
    console.error('❌ Error deleting student:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENTS WITHOUT ACCOUNTS
// ==========================================
router.get('/without-accounts', async (req, res) => {
  try {
    console.log('👤 Fetching students without accounts...');
    
    const result = await pool.query(
      `SELECT s.*
       FROM students s
       WHERE s.user_id IS NULL 
         AND s.enrollment_status = 'Active'
       ORDER BY s.first_name`
    );
    
    res.json({ 
      success: true, 
      count: result.rows.length,
      students: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching students without accounts:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENT BY STUDENT CODE (for parent/student view)
// ==========================================
router.get('/code/:studentCode', async (req, res) => {
  try {
    console.log(`🔍 Fetching student by code: ${req.params.studentCode}`);
    
    const result = await pool.query(
      `SELECT student_id, student_code, first_name, last_name, 
              current_standard, current_class, parent_name, parent_phone,
              total_fees, amount_paid, outstanding_balance, user_id
       FROM students 
       WHERE student_code = $1 AND enrollment_status = 'Active'`,
      [req.params.studentCode]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Student not found or inactive' 
      });
    }
    
    res.json({ 
      success: true, 
      student: result.rows[0] 
    });
  } catch (error) {
    console.error('❌ Error fetching student by code:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET RECENT STUDENTS
// ==========================================
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    const result = await pool.query(
      `SELECT id, student_id, student_code, first_name, last_name, 
              current_standard, parent_name, outstanding_balance, 
              enrollment_status, user_id, created_at
       FROM students 
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit]
    );
    
    res.json({ 
      success: true, 
      count: result.rows.length,
      students: result.rows
    });
  } catch (error) {
    console.error('❌ Error fetching recent students:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==========================================
// GET STUDENT BULK UPDATE STATUS
// ==========================================
router.post('/bulk-status', async (req, res) => {
  try {
    const { studentIds, status } = req.body;
    
    if (!studentIds || !status) {
      return res.status(400).json({
        success: false,
        error: 'Student IDs and status are required'
      });
    }
    
    const result = await pool.query(
      `UPDATE students 
       SET enrollment_status = $1, updated_at = NOW()
       WHERE student_id = ANY($2)
       RETURNING student_id, first_name, last_name, enrollment_status`,
      [status, studentIds]
    );
    
    res.json({
      success: true,
      message: `Updated ${result.rows.length} students`,
      students: result.rows
    });
  } catch (error) {
    console.error('❌ Error updating bulk status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;