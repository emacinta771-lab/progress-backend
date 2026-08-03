const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { createWorker } = require('tesseract.js');
const OpenAI = require('openai').default;
const pool = require('../config/database');
const { s3Client, bucketName, isCloudflareConfigured, getPublicUrl, generateFileName } = require('../config/cloudflare');

// ── OpenAI Vision helper ──────────────────────────────────────────────────────

/**
 * Fetch a remote image and return it as a base64 data-URL string.
 */
const fetchImageAsBase64 = (url) =>
  new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mime};base64,${buffer.toString('base64')}`);
      });
      res.on('error', reject);
    }).on('error', reject);
  });

/**
 * Use OpenAI GPT-4o Vision to analyse a receipt image.
 * Returns null if OPENAI_API_KEY is not set or the call fails.
 */
const analyzeWithOpenAI = async (imageUrl, localFilePath) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') return null;

  const openai = new OpenAI({ apiKey });

  // Build image content — local file preferred (faster, no public URL needed)
  let imageContent;
  if (localFilePath && fs.existsSync(localFilePath)) {
    const buffer = fs.readFileSync(localFilePath);
    const ext = path.extname(localFilePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.bmp': 'image/bmp', '.pdf': 'application/pdf' };
    const mime = mimeMap[ext] || 'image/jpeg';
    imageContent = {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buffer.toString('base64')}`, detail: 'high' },
    };
  } else if (imageUrl) {
    // If it's already a public URL, pass it directly; otherwise fetch and base64-encode
    const isPublicUrl = imageUrl.startsWith('http');
    const dataUrl = isPublicUrl ? imageUrl : await fetchImageAsBase64(imageUrl);
    imageContent = { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };
  } else {
    return null;
  }

  const prompt = `You are an expert school payment receipt analyser.
Analyse this receipt image and return ONLY valid JSON — no markdown fences, no explanation.

The JSON must have these exact fields:
{
  "amount": <number or null>,
  "currency": "<string, e.g. MK>",
  "payment_method": "<Cash | Mobile Money | Bank Transfer | Cheque | Other>",
  "payer_name": "<string or null>",
  "payment_date": "<YYYY-MM-DD or null>",
  "receipt_number": "<string or null>",
  "bank_name": "<string or null>",
  "reference": "<string or null>",
  "is_valid_receipt": <true|false>,
  "confidence": <0-100 integer>,
  "anomalies": ["<list any suspicious items, empty array if none>"],
  "summary": "<1-2 sentence plain-English summary for the accountant>"
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          imageContent,
        ],
      },
    ],
  });

  const text = response.choices[0].message.content.trim();
  // Strip markdown code fences if the model wraps the JSON
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(clean);
};

// ── OCR helper (Tesseract) ────────────────────────────────────────────────────

const extractReceiptData = async (filePath, fallbackStudentName = '') => {
  const fallback = {
    amount: 0,
    student_name: fallbackStudentName || 'Unknown Student',
    payment_method: 'Cash',
    confidence: 0,
    extracted_text: ''
  };

  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(filePath);
    await worker.terminate();

    const text = data?.text || '';
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const lines = normalizedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);

    const amountMatch = normalizedText.match(/(?:amount|total|paid|fee|fees|balance|payable)\D{0,12}([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
    const fallbackAmountMatch = normalizedText.match(/\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/);
    const amountValue = amountMatch?.[1] || fallbackAmountMatch?.[1] || '0';

    let studentName = fallbackStudentName || 'Unknown Student';
    const studentLine = lines.find((line) => /student|name|payer|paid by|received from/i.test(line));
    if (studentLine) {
      const cleaned = studentLine
        .replace(/^(student|name|payer|paid by|received from)[:\-\s]*/i, '')
        .replace(/\bfrom\b/i, '')
        .trim();
      if (cleaned && cleaned.length > 2 && !/^mk|^k|^amount|^total|^fee/i.test(cleaned)) {
        studentName = cleaned;
      }
    }

    let paymentMethod = 'Cash';
    if (/mobile|moov|airtel|tnm|bank|transfer|mpamba|orange/i.test(normalizedText)) {
      paymentMethod = 'Mobile Money';
    } else if (/cash/i.test(normalizedText)) {
      paymentMethod = 'Cash';
    }

    return {
      amount: Number(String(amountValue).replace(/,/g, '')) || 0,
      student_name: studentName,
      payment_method: paymentMethod,
      confidence: Math.max(40, Math.min(95, Math.round((data?.confidence || 0) * 0.95))),
      extracted_text: normalizedText
    };
  } catch (error) {
    console.error('⚠️ OCR extraction failed:', error.message);
    return fallback;
  }
};

// ── Multer config ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use system temp dir to avoid OneDrive permission conflicts
    const uploadDir = path.join(os.tmpdir(), 'sms-receipts');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'receipt-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'image/webp', 'image/heic', 'image/heif', 'image/bmp',
      'application/pdf',
    ];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type (${file.mimetype}). Allowed: JPEG, PNG, PDF, WEBP, HEIC.`));
    }
  }
});

// ==========================================
// STUDENT UPLOAD RECEIPT
// ==========================================
router.post('/upload', upload.single('receipt'), async (req, res) => {
  try {
    const { student_id, student_name, student_code } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No receipt image uploaded' });
    }

    if (!student_id) {
      return res.status(400).json({ success: false, error: 'Student ID is required' });
    }

    let imageUrl = `/uploads/receipts/${file.filename}`;
    let storagePath = file.path;
    const extractedData = await extractReceiptData(file.path, student_name || '');

    if (isCloudflareConfigured() && s3Client) {
      try {
        const key = generateFileName(student_id, file.originalname);
        const fileBuffer = fs.readFileSync(file.path);

        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: fileBuffer,
          ContentType: file.mimetype,
        }));

        imageUrl = getPublicUrl(key);
        storagePath = key;
        console.log(`✅ Receipt uploaded to Cloudflare R2: ${key}`);
      } catch (uploadError) {
        console.error('⚠️ Cloudflare R2 upload failed, falling back to local storage:', uploadError.message);
      }
    }

    const result = await pool.query(`
      INSERT INTO receipt_repository (
        student_id,
        student_name,
        student_code,
        receipt_image_url,
        receipt_image_path,
        extracted_data,
        confidence_score,
        status,
        uploaded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [student_id, student_name || 'Unknown', student_code || null, imageUrl, storagePath, extractedData, extractedData.confidence || 0, 'Pending']);

    res.status(201).json({
      success: true,
      message: 'Receipt uploaded successfully',
      receipt: result.rows[0]
    });

  } catch (error) {
    console.error('Error uploading receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// UPLOAD RECEIPT WITH AI DATA
// ==========================================
router.post('/upload-with-ai', upload.single('receipt'), async (req, res) => {
  try {
    const { 
      student_id, 
      student_name, 
      student_code,
      amount,
      payment_date,
      receipt_number,
      payment_method,
      confidence,
      ai_analyzed
    } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No receipt image uploaded' });
    }

    if (!student_id) {
      return res.status(400).json({ success: false, error: 'Student ID is required' });
    }

    let imageUrl = `/uploads/receipts/${file.filename}`;
    let storagePath = file.path;

    if (isCloudflareConfigured() && s3Client) {
      try {
        const key = generateFileName(student_id, file.originalname);
        const fileBuffer = fs.readFileSync(file.path);

        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: fileBuffer,
          ContentType: file.mimetype,
        }));

        imageUrl = getPublicUrl(key);
        storagePath = key;
        console.log(`✅ Receipt uploaded to Cloudflare R2: ${key}`);
      } catch (uploadError) {
        console.error('⚠️ Cloudflare R2 upload failed, falling back to local storage:', uploadError.message);
      }
    }

    // Build extracted data from AI
    const extractedData = {
      amount: amount || 0,
      payment_date: payment_date || null,
      receipt_number: receipt_number || null,
      payment_method: payment_method || 'Cash',
      confidence: confidence || 0,
      ai_analyzed: ai_analyzed === 'true',
      student_name: student_name || 'Unknown Student'
    };

    const result = await pool.query(`
      INSERT INTO receipt_repository (
        student_id,
        student_name,
        student_code,
        receipt_image_url,
        receipt_image_path,
        amount,
        payment_date,
        receipt_number,
        payment_method,
        confidence_score,
        extracted_data,
        status,
        uploaded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *
    `, [
      student_id, 
      student_name || 'Unknown', 
      student_code || null, 
      imageUrl, 
      storagePath,
      amount || 0,
      payment_date || null,
      receipt_number || null,
      payment_method || 'Cash',
      confidence || 0,
      extractedData,
      'Analyzed'
    ]);

    res.status(201).json({
      success: true,
      message: 'Receipt uploaded successfully with AI analysis',
      receipt: result.rows[0],
      imageUrl: imageUrl
    });

  } catch (error) {
    console.error('Error uploading receipt with AI:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET ALL RECEIPTS (Accountant)
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { status, student_id, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT
        r.*,
        u.first_name as verified_by_name,
        TO_CHAR(r.uploaded_at, 'YYYY-MM-DD HH24:MI') as uploaded_date,
        TO_CHAR(r.analyzed_at, 'YYYY-MM-DD HH24:MI') as analyzed_date,
        TO_CHAR(r.verified_at, 'YYYY-MM-DD HH24:MI') as verified_date
      FROM receipt_repository r
      LEFT JOIN users u ON r.verified_by = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND r.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (student_id) {
      query += ` AND r.student_id = $${paramCount}`;
      params.push(student_id);
      paramCount++;
    }

    query += ` ORDER BY r.uploaded_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM receipt_repository WHERE 1=1';
    const countParams = [];
    let countParam = 1;

    if (status) {
      countQuery += ` AND status = $${countParam}`;
      countParams.push(status);
      countParam++;
    }

    if (student_id) {
      countQuery += ` AND student_id = $${countParam}`;
      countParams.push(student_id);
      countParam++;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      receipts: result.rows,
      total: parseInt(countResult.rows[0].total) || 0,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET RECEIPT STATISTICS
// ==========================================
router.get('/stats/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_receipts,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'Analyzed' THEN 1 END) as analyzed,
        COUNT(CASE WHEN status = 'Verified' THEN 1 END) as verified,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN DATE(uploaded_at) = CURRENT_DATE THEN 1 END) as uploaded_today,
        ROUND(AVG(confidence_score), 2) as avg_confidence,
        SUM(amount) as total_amount
      FROM receipt_repository
    `);

    res.json({ success: true, stats: result.rows[0] });

  } catch (error) {
    console.error('Error fetching receipt stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// GET RECEIPT BY ID
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT
        r.*,
        u.first_name as verified_by_name,
        TO_CHAR(r.uploaded_at, 'YYYY-MM-DD HH24:MI') as uploaded_date,
        TO_CHAR(r.analyzed_at, 'YYYY-MM-DD HH24:MI') as analyzed_date,
        TO_CHAR(r.verified_at, 'YYYY-MM-DD HH24:MI') as verified_date
      FROM receipt_repository r
      LEFT JOIN users u ON r.verified_by = u.id
      WHERE r.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    res.json({ success: true, receipt: result.rows[0] });

  } catch (error) {
    console.error('Error fetching receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// ANALYZE RECEIPT (OCR / Tesseract)
// ==========================================
router.post('/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const { extracted_data } = req.body;

    const receipt = await pool.query('SELECT receipt_image_path, student_name FROM receipt_repository WHERE id = $1', [id]);
    const receiptRow = receipt.rows[0];
    const filePath = receiptRow?.receipt_image_path && fs.existsSync(receiptRow.receipt_image_path) ? receiptRow.receipt_image_path : null;
    const ocrData = filePath
      ? await extractReceiptData(filePath, receiptRow?.student_name || '')
      : {
          amount: 0,
          student_name: receiptRow?.student_name || 'Unknown Student',
          payment_method: 'Cash',
          confidence: 0,
          extracted_text: ''
        };

    const analysisData = {
      ...(extracted_data || {}),
      ...ocrData,
      amount: extracted_data?.amount || ocrData.amount || 0,
      student_name: extracted_data?.student_name || ocrData.student_name || receiptRow?.student_name || 'Unknown Student',
      payment_method: extracted_data?.payment_method || ocrData.payment_method || 'Cash',
      confidence: extracted_data?.confidence || ocrData.confidence || 0,
      extracted_text: extracted_data?.extracted_text || ocrData.extracted_text || ''
    };

    const result = await pool.query(`
      UPDATE receipt_repository
      SET
        status = 'Analyzed',
        extracted_data = $1,
        confidence_score = $2,
        analyzed_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [analysisData, analysisData.confidence || 0, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    res.json({
      success: true,
      message: 'Receipt analyzed successfully',
      receipt: result.rows[0]
    });

  } catch (error) {
    console.error('Error analyzing receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// AI ANALYZE RECEIPT (OpenAI GPT-4o Vision)
// ==========================================
router.post('/:id/ai-analyze', async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await pool.query(
      'SELECT receipt_image_url, receipt_image_path, student_name FROM receipt_repository WHERE id = $1',
      [id]
    );

    if (receipt.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    const row = receipt.rows[0];
    const localPath = row.receipt_image_path && fs.existsSync(row.receipt_image_path)
      ? row.receipt_image_path
      : null;

    const aiResult = await analyzeWithOpenAI(row.receipt_image_url, localPath);

    if (!aiResult) {
      return res.status(503).json({
        success: false,
        error: 'AI analysis unavailable. Make sure OPENAI_API_KEY is set in the backend .env file.',
      });
    }

    const merged = {
      ...aiResult,
      ai_analyzed: true,
      analyzed_by: 'gpt-4o',
      analyzed_at: new Date().toISOString(),
    };

    const updated = await pool.query(
      `UPDATE receipt_repository
       SET status = CASE WHEN status = 'Pending' THEN 'Analyzed' ELSE status END,
           extracted_data = $1,
           confidence_score = $2,
           analyzed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [merged, aiResult.confidence ?? 0, id]
    );

    res.json({
      success: true,
      message: 'AI analysis complete',
      ai_analysis: aiResult,
      receipt: updated.rows[0],
    });

  } catch (error) {
    console.error('Error during AI analysis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// VERIFY RECEIPT (Accountant)
// ==========================================
router.put('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { verified_by, notes } = req.body;

    const result = await pool.query(`
      UPDATE receipt_repository
      SET
        status = 'Verified',
        verified_by = $1,
        verified_at = NOW(),
        notes = COALESCE($2, notes)
      WHERE id = $3
      RETURNING *
    `, [verified_by, notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    res.json({
      success: true,
      message: 'Receipt verified successfully',
      receipt: result.rows[0]
    });

  } catch (error) {
    console.error('Error verifying receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// REJECT RECEIPT
// ==========================================
router.put('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await pool.query(`
      UPDATE receipt_repository
      SET
        status = 'Rejected',
        notes = COALESCE($1, notes)
      WHERE id = $2
      RETURNING *
    `, [notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    res.json({
      success: true,
      message: 'Receipt rejected',
      receipt: result.rows[0]
    });

  } catch (error) {
    console.error('Error rejecting receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// DELETE RECEIPT
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await pool.query(
      'SELECT receipt_image_path FROM receipt_repository WHERE id = $1',
      [id]
    );

    if (receipt.rows.length > 0 && receipt.rows[0].receipt_image_path) {
      try {
        fs.unlinkSync(receipt.rows[0].receipt_image_path);
      } catch (e) {
        console.log('File already deleted or not found:', e.message);
      }
    }

    await pool.query('DELETE FROM receipt_repository WHERE id = $1', [id]);

    res.json({ success: true, message: 'Receipt deleted successfully' });

  } catch (error) {
    console.error('Error deleting receipt:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;