const pool = require('../config/database');

class Student {
  // ==========================================
  // GET ALL STUDENTS
  // ==========================================
  static async findAll() {
    try {
      const result = await pool.query(`
        SELECT 
          s.*,
          COALESCE(
            (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status = 'Present'),
            0
          ) as present_count,
          COALESCE(
            (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status = 'Absent'),
            0
          ) as absent_count
        FROM students s 
        ORDER BY s.created_at DESC
      `);
      return result.rows;
    } catch (error) {
      console.error('❌ Error in findAll:', error);
      throw error;
    }
  }

  // ==========================================
  // GET STUDENT BY ID
  // ==========================================
  static async findById(studentId) {
    try {
      const result = await pool.query(`
        SELECT 
          s.*,
          COALESCE(
            (SELECT json_agg(a) FROM attendance a WHERE a.student_id = s.id ORDER BY a.date DESC LIMIT 10),
            '[]'
          ) as recent_attendance,
          COALESCE(
            (SELECT json_agg(p) FROM payments p WHERE p.student_id = s.id ORDER BY p.payment_date DESC LIMIT 5),
            '[]'
          ) as recent_payments
        FROM students s 
        WHERE s.student_id = $1
      `, [studentId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error in findById:', error);
      throw error;
    }
  }

  // ==========================================
  // GET STUDENTS BY STANDARD
  // ==========================================
  static async findByStandard(standard) {
    try {
      const result = await pool.query(
        `SELECT * FROM students 
         WHERE current_standard = $1 AND enrollment_status = 'Active' 
         ORDER BY first_name`,
        [standard]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error in findByStandard:', error);
      throw error;
    }
  }

  // ==========================================
  // CREATE STUDENT - WITH student_code
  // ==========================================
  static async create(studentData) {
    console.log('📝 Creating student with data:', studentData);
    
    try {
      const {
        student_code, student_id, first_name, last_name, middle_name,
        date_of_birth, gender, phone, village, traditional_authority,
        district, division, parent_name, parent_phone, parent_email,
        parent_occupation, parent_relationship, parent_village,
        current_standard, current_class, enrollment_date, academic_year,
        enrollment_status, previous_grade_promoted, performance_level,
        blood_type, allergies, medical_conditions,
        emergency_contact_name, emergency_contact_phone,
        emergency_contact_relationship, total_fees, amount_paid,
        outstanding_balance, fee_payment_plan, scholarship_type,
        financial_hold, has_uniform, has_textbooks, meals_program, notes,
        // ── new fields ──
        lin_code, age, location, religious_denomination,
        orphan_status, special_needs, special_needs_description,
        ecd_attendance, submission_date
      } = studentData;

      // Validate required fields
      const requiredFields = [
        'student_code', 'student_id', 'first_name', 'last_name', 'date_of_birth',
        'gender', 'district', 'parent_name', 'parent_phone',
        'parent_relationship', 'current_standard', 'academic_year',
        'emergency_contact_name', 'emergency_contact_phone'
      ];
      
      for (const field of requiredFields) {
        if (!studentData[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Check duplicates
      const existing = await pool.query(
        'SELECT student_code FROM students WHERE student_code = $1',
        [student_code]
      );
      if (existing.rows.length > 0) throw new Error('Student Code already exists');

      const existingId = await pool.query(
        'SELECT student_id FROM students WHERE student_id = $1',
        [student_id]
      );
      if (existingId.rows.length > 0) throw new Error('Student ID already exists');

      if (lin_code) {
        const existingLin = await pool.query(
          'SELECT lin_code FROM students WHERE lin_code = $1',
          [lin_code]
        );
        if (existingLin.rows.length > 0) throw new Error('LIN Code already exists');
      }

      // Defaults
      const finalEnrollmentDate       = enrollment_date || new Date().toISOString().split('T')[0];
      const finalEnrollmentStatus     = enrollment_status || 'Active';
      const finalPreviousGradePromoted= previous_grade_promoted !== undefined ? previous_grade_promoted : true;
      const finalPerformanceLevel     = performance_level || 'Satisfactory';
      const finalAmountPaid           = parseFloat(amount_paid) || 0;
      const finalOutstandingBalance   = outstanding_balance !== undefined
        ? parseFloat(outstanding_balance)
        : (parseFloat(total_fees) || 0);
      const finalFinancialHold        = financial_hold !== undefined ? financial_hold : false;

      const result = await pool.query(
        `INSERT INTO students (
          student_code, student_id, first_name, last_name, middle_name,
          date_of_birth, gender, phone, village, traditional_authority,
          district, division, parent_name, parent_phone, parent_email,
          parent_occupation, parent_relationship, parent_village,
          current_standard, current_class, enrollment_date, academic_year,
          enrollment_status, previous_grade_promoted, performance_level,
          blood_type, allergies, medical_conditions,
          emergency_contact_name, emergency_contact_phone,
          emergency_contact_relationship, total_fees, amount_paid,
          outstanding_balance, fee_payment_plan, scholarship_type,
          financial_hold, has_uniform, has_textbooks, meals_program, notes,
          lin_code, age, location, religious_denomination,
          orphan_status, special_needs, special_needs_description,
          ecd_attendance, submission_date
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
          $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
          $41,$42,$43,$44,$45,$46,$47,$48,$49,$50
        ) RETURNING *`,
        [
          student_code, student_id, first_name, last_name, middle_name || null,
          date_of_birth, gender, phone || null, village || null, traditional_authority || null,
          district, division || null, parent_name, parent_phone, parent_email || null,
          parent_occupation || null, parent_relationship, parent_village || null,
          parseInt(current_standard), current_class || null, finalEnrollmentDate, academic_year,
          finalEnrollmentStatus, finalPreviousGradePromoted, finalPerformanceLevel,
          blood_type || null, allergies || null, medical_conditions || null,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relationship || null,
          parseFloat(total_fees) || 0, finalAmountPaid, finalOutstandingBalance,
          fee_payment_plan || 'Full', scholarship_type || 'None',
          finalFinancialHold, has_uniform || false, has_textbooks || false,
          meals_program || 'None', notes || null,
          // new fields
          lin_code || null,
          age ? parseInt(age) : null,
          location || null,
          religious_denomination || null,
          orphan_status || 'None',
          special_needs || false,
          special_needs_description || null,
          ecd_attendance || 'No',
          submission_date || new Date().toISOString().split('T')[0]
        ]
      );
      
      console.log('✅ Student created successfully:', result.rows[0]);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Error in create:', error.message);
      throw error;
    }
  }

  // ==========================================
  // GET STATISTICS
  // ==========================================
  static async getStatistics() {
    try {
      console.log('📊 Fetching statistics from database...');
      
      const result = await pool.query(`
        SELECT 
          COUNT(*) as total_students,
          COUNT(CASE WHEN enrollment_status = 'Active' THEN 1 END) as active_students,
          COUNT(CASE WHEN enrollment_status = 'Graduated' THEN 1 END) as graduated_students,
          COUNT(CASE WHEN enrollment_status = 'Transferred' THEN 1 END) as transferred_students,
          COUNT(CASE WHEN enrollment_status = 'Dropped Out' THEN 1 END) as dropped_out_students,
          COUNT(CASE WHEN financial_hold = true THEN 1 END) as financial_holds,
          COALESCE(SUM(outstanding_balance), 0) as total_outstanding_balance,
          COALESCE(SUM(total_fees), 0) as total_fees_collected,
          COALESCE(SUM(amount_paid), 0) as total_amount_paid,
          COUNT(CASE WHEN has_uniform = true THEN 1 END) as students_with_uniform,
          COUNT(CASE WHEN has_textbooks = true THEN 1 END) as students_with_textbooks,
          COUNT(CASE WHEN meals_program = 'Full' THEN 1 END) as full_meals,
          COUNT(CASE WHEN gender = 'Male' THEN 1 END) as male_students,
          COUNT(CASE WHEN gender = 'Female' THEN 1 END) as female_students
        FROM students
      `);
      
      const stats = result.rows[0];
      console.log('✅ Statistics fetched:', stats);
      
      return {
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
        male_students: parseInt(stats.male_students) || 0,
        female_students: parseInt(stats.female_students) || 0
      };
    } catch (error) {
      console.error('❌ Error in getStatistics:', error);
      throw error;
    }
  }

  // ==========================================
  // SEARCH STUDENTS
  // ==========================================
  static async search(searchTerm) {
    try {
      const result = await pool.query(
        `SELECT * FROM students 
         WHERE 
           first_name ILIKE $1 OR 
           last_name ILIKE $1 OR 
           student_code ILIKE $1 OR
           student_id ILIKE $1 OR
           lin_code ILIKE $1 OR
           parent_name ILIKE $1 OR
           district ILIKE $1
         ORDER BY created_at DESC`,
        [`%${searchTerm}%`]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error in search:', error);
      throw error;
    }
  }

  // ==========================================
  // GET FEE STATUS
  // ==========================================
  static async getFeeStatus(studentId) {
    try {
      const result = await pool.query(
        `SELECT 
          student_code, student_id, first_name, last_name,
          total_fees, amount_paid, outstanding_balance,
          financial_hold, scholarship_type, fee_payment_plan
         FROM students 
         WHERE student_id = $1`,
        [studentId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error in getFeeStatus:', error);
      throw error;
    }
  }

  // ==========================================
  // GET STUDENTS WITH OUTSTANDING FEES
  // ==========================================
  static async getStudentsWithOutstandingFees() {
    try {
      const result = await pool.query(
        `SELECT 
          id, student_code, student_id, first_name, last_name,
          current_standard, parent_name, outstanding_balance,
          financial_hold
         FROM students 
         WHERE outstanding_balance > 0 
         ORDER BY outstanding_balance DESC`
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error in getStudentsWithOutstandingFees:', error);
      throw error;
    }
  }

  // ==========================================
  // RECORD PAYMENT
  // ==========================================
  static async recordPayment(studentId, paymentData) {
    const { amount, method, receipt_number, payment_period, notes } = paymentData;
    
    if (!amount || amount <= 0) {
      throw new Error('Invalid payment amount');
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const student = await client.query(
        'SELECT id, amount_paid, total_fees, outstanding_balance FROM students WHERE student_id = $1',
        [studentId]
      );

      if (!student.rows[0]) {
        throw new Error('Student not found');
      }

      const currentAmountPaid = parseFloat(student.rows[0].amount_paid) || 0;
      const currentTotalFees = parseFloat(student.rows[0].total_fees) || 0;
      const newAmountPaid = currentAmountPaid + parseFloat(amount);
      const newBalance = currentTotalFees - newAmountPaid;

      const finalReceiptNumber = receipt_number || `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      await client.query(
        `INSERT INTO payments (student_id, amount, payment_method, receipt_number, payment_period, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [student.rows[0].id, amount, method || 'Cash', finalReceiptNumber, payment_period || 'General', notes || null]
      );

      const updatedStudent = await client.query(
        `UPDATE students 
         SET amount_paid = $1, outstanding_balance = $2
         WHERE student_id = $3
         RETURNING *`,
        [newAmountPaid, newBalance, studentId]
      );

      await client.query('COMMIT');
      console.log(`💰 Payment recorded: ${amount} for student ${studentId}`);
      return updatedStudent.rows[0];
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in recordPayment:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // UPDATE STUDENT
  // ==========================================
  static async update(studentId, updates) {
    try {
      const allowedFields = [
        'student_code', 'first_name', 'last_name', 'middle_name', 'date_of_birth', 'gender',
        'phone', 'village', 'traditional_authority', 'district', 'division',
        'parent_name', 'parent_phone', 'parent_email', 'parent_occupation',
        'parent_relationship', 'parent_village', 'current_standard',
        'current_class', 'academic_year', 'enrollment_status',
        'emergency_contact_name', 'emergency_contact_phone',
        'emergency_contact_relationship', 'fee_payment_plan',
        'scholarship_type', 'has_uniform', 'has_textbooks', 'meals_program',
        'notes', 'performance_level', 'financial_hold',
        // new fields
        'lin_code', 'age', 'location', 'religious_denomination',
        'orphan_status', 'special_needs', 'special_needs_description',
        'ecd_attendance', 'submission_date'
      ];

      const setClause = [];
      const values = [];
      let paramCounter = 1;

      if (updates.total_fees !== undefined || updates.amount_paid !== undefined) {
        const current = await pool.query(
          'SELECT total_fees, amount_paid FROM students WHERE student_id = $1',
          [studentId]
        );
        
        const totalFees = updates.total_fees ?? current.rows[0]?.total_fees ?? 0;
        const amountPaid = updates.amount_paid ?? current.rows[0]?.amount_paid ?? 0;
        
        updates.outstanding_balance = parseFloat(totalFees) - parseFloat(amountPaid);
      }

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) || 
            ['total_fees', 'amount_paid', 'outstanding_balance'].includes(key)) {
          setClause.push(`${key} = $${paramCounter}`);
          values.push(value);
          paramCounter++;
        }
      }

      if (setClause.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(studentId);
      const query = `
        UPDATE students 
        SET ${setClause.join(', ')}, updated_at = NOW()
        WHERE student_id = $${paramCounter}
        RETURNING *
      `;

      const result = await pool.query(query, values);
      return result.rows[0];
      
    } catch (error) {
      console.error('❌ Error in update:', error);
      throw error;
    }
  }

  // ==========================================
  // DELETE STUDENT
  // ==========================================
  static async delete(studentId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const studentResult = await client.query(
        `SELECT id, student_id
         FROM students
         WHERE student_id = $1 OR CAST(id AS TEXT) = $1
         LIMIT 1`,
        [String(studentId)]
      );

      if (studentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const target = studentResult.rows[0];

      const tableExists = async (tableName) => {
        const existsResult = await client.query(
          `SELECT EXISTS (
             SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
           ) AS exists`,
          [tableName]
        );
        return Boolean(existsResult.rows[0]?.exists);
      };

      // Remove dependent rows first for databases without ON DELETE CASCADE.
      if (await tableExists('payments')) {
        await client.query('DELETE FROM payments WHERE student_id = $1', [target.id]);
      }
      if (await tableExists('grades')) {
        await client.query('DELETE FROM grades WHERE student_id = $1', [target.id]);
      }
      if (await tableExists('attendance')) {
        await client.query('DELETE FROM attendance WHERE student_id = $1', [target.id]);
      }
      if (await tableExists('receipt_repository')) {
        await client.query('DELETE FROM receipt_repository WHERE student_id = $1', [target.id]);
      }
      if (await tableExists('notifications')) {
        await client.query('DELETE FROM notifications WHERE student_id = $1', [target.id]);
      }
      if (await tableExists('student_credentials')) {
        await client.query('DELETE FROM student_credentials WHERE student_id = $1', [target.student_id]);
      }
      // Unlink user account (don't delete the user — just detach)
      if (await tableExists('users')) {
        await client.query(
          `UPDATE users SET student_id = NULL, is_student = FALSE WHERE student_id = $1`,
          [target.student_id]
        );
      }

      const result = await client.query(
        'DELETE FROM students WHERE id = $1 RETURNING *',
        [target.id]
      );

      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in delete:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // GET PAYMENT HISTORY
  // ==========================================
  static async getPaymentHistory(studentId) {
    try {
      const result = await pool.query(
        `SELECT 
          p.id, p.amount, p.payment_date, p.payment_method, 
          p.receipt_number, p.payment_period, p.notes
         FROM payments p
         JOIN students s ON p.student_id = s.id
         WHERE s.student_id = $1
         ORDER BY p.payment_date DESC`,
        [studentId]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error in getPaymentHistory:', error);
      throw error;
    }
  }

  // ==========================================
  // GET ALL PAYMENTS
  // ==========================================
  static async getAllPayments(limit = 10) {
    try {
      const result = await pool.query(
        `SELECT 
          p.id, p.amount, p.payment_date, p.payment_method, 
          p.receipt_number, p.payment_period,
          s.student_code, s.student_id, s.first_name, s.last_name
         FROM payments p
         JOIN students s ON p.student_id = s.id
         ORDER BY p.payment_date DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error in getAllPayments:', error);
      throw error;
    }
  }

  // ==========================================
  // GET ATTENDANCE SUMMARY
  // ==========================================
  static async getAttendanceSummary(studentId) {
    try {
      const result = await pool.query(`
        SELECT 
          COUNT(CASE WHEN status = 'Present' THEN 1 END) as present_days,
          COUNT(CASE WHEN status = 'Absent' THEN 1 END) as absent_days,
          COUNT(CASE WHEN status = 'Excused' THEN 1 END) as excused_days,
          COUNT(CASE WHEN status = 'Late' THEN 1 END) as late_days,
          COUNT(*) as total_days
        FROM attendance
        WHERE student_id = (SELECT id FROM students WHERE student_id = $1)
        AND date >= CURRENT_DATE - INTERVAL '30 days'
      `, [studentId]);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error in getAttendanceSummary:', error);
      throw error;
    }
  }
}

module.exports = Student;