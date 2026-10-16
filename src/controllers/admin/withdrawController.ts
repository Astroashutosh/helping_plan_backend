import { Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * GET /api/admin/withdrawals
 * Supports tab ('pending' | 'history' | 'all'), search, pagination
 * Matches Laravel withdrawPendingUSDTLog, ajaxPendingUSDTWithdraw, withdrawUSDTLog, ajaxUSDTLogWithdraw
 */
export const getWithdrawals = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tab = (req.query.tab as string) || 'pending';
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 50));
    const offset = (page - 1) * limit;

    // 1. Fetch Aggregated Statistics
    const [statsRows]: any = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'pending' OR status = '0' THEN 1 ELSE 0 END), 0) as pending_count,
        COALESCE(SUM(CASE WHEN status = 'pending' OR status = '0' THEN total_amount ELSE 0 END), 0) as pending_total_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' OR status = '1' THEN 1 ELSE 0 END), 0) as approved_count,
        COALESCE(SUM(CASE WHEN status = 'approved' OR status = '1' THEN total_amount ELSE 0 END), 0) as approved_total_amount,
        COALESCE(SUM(CASE WHEN status = 'rejected' OR status = '2' THEN 1 ELSE 0 END), 0) as rejected_count,
        COALESCE(SUM(CASE WHEN status = 'rejected' OR status = '2' THEN total_amount ELSE 0 END), 0) as rejected_total_amount
      FROM withdraw_transactions
    `);

    const stats = statsRows[0] || {
      total_count: 0,
      pending_count: 0,
      pending_total_amount: 0,
      approved_count: 0,
      approved_total_amount: 0,
      rejected_count: 0,
      rejected_total_amount: 0,
    };

    // 2. Build Query Filters
    const conditions: string[] = [];
    const params: any[] = [];

    if (tab === 'pending') {
      conditions.push("(wt.status = 'pending' OR wt.status = '0')");
    } else if (tab === 'history') {
      conditions.push("wt.status IN ('approved', 'rejected', '1', '2')");
    }

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR wt.withdraw_id LIKE ? OR wt.wallet_address LIKE ?)");
      const searchParam = `%${uname}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 3. Count Total Matching Records
    const [countResult]: any = await pool.query(`
      SELECT COUNT(*) as total
      FROM withdraw_transactions wt
      LEFT JOIN users u ON u.id = wt.user_id
      ${whereClause}
    `, params);

    const totalRecords = countResult[0]?.total || 0;

    // 4. Fetch Paginated Records with Joined User Details
    const [rows]: any = await pool.query(`
      SELECT 
        wt.id,
        wt.withdraw_id,
        wt.user_id,
        wt.amount,
        wt.token_price,
        wt.token_rate,
        wt.charge,
        wt.total_amount,
        wt.wallet_address,
        wt.method_name,
        wt.processing_time,
        wt.status,
        wt.payment_status,
        wt.comment,
        wt.withdraw_wallet,
        wt.transaction_hash,
        wt.bank_info,
        wt.created_at,
        wt.updated_at,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_no as phone
      FROM withdraw_transactions wt
      LEFT JOIN users u ON u.id = wt.user_id
      ${whereClause}
      ORDER BY wt.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return res.json({
      success: true,
      data: rows,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
      stats: {
        pending_total_count: parseInt(stats.pending_count || 0),
        pending_total_amount: parseFloat(stats.pending_total_amount || 0),
        approved_total_count: parseInt(stats.approved_count || 0),
        approved_total_amount: parseFloat(stats.approved_total_amount || 0),
        rejected_total_count: parseInt(stats.rejected_count || 0),
        rejected_total_amount: parseFloat(stats.rejected_total_amount || 0),
        total_count: parseInt(stats.total_count || 0),
      },
    });
  } catch (error: any) {
    console.error('Error in getWithdrawals:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawals',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/withdrawals/:id
 * Matches Laravel detailWithdraw($id)
 */
export const getWithdrawalDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId as string);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal ID' });
    }

    const [rows]: any = await pool.query(`
      SELECT 
        wt.*,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_no as phone,
        uw.balance as user_balance,
        uw.donation_wallet as user_donation_wallet
      FROM withdraw_transactions wt
      LEFT JOIN users u ON u.id = wt.user_id
      LEFT JOIN user_wallets uw ON uw.user_id = wt.user_id
      WHERE wt.id = ?
      LIMIT 1
    `, [id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Withdrawal record not found' });
    }

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (error: any) {
    console.error('Error in getWithdrawalDetails:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch withdrawal details',
      error: error.message,
    });
  }
};

/**
 * POST /api/admin/withdrawals/:id/process
 * Matches Laravel repondWithdraw(Request $request, $id)
 * Handles approval and rejection with automatic wallet refund if rejected.
 */
export const processWithdrawal = async (req: AuthenticatedRequest, res: Response) => {
  const connection = await pool.getConnection();
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId as string);
    const { status, message, transaction_hash } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal ID' });
    }

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be either 'approved' or 'rejected'" });
    }

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'Message/Remark is required' });
    }

    await connection.beginTransaction();

    // 1. Lock and fetch current withdrawal record
    const [withdrawRows]: any = await connection.query(`
      SELECT * FROM withdraw_transactions WHERE id = ? FOR UPDATE
    `, [id]);

    if (!withdrawRows || withdrawRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    const withdraw = withdrawRows[0];

    // Check if already processed
    if (withdraw.status !== 'pending' && withdraw.status !== '0') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Withdrawal request is already processed (Status: ${withdraw.status})`,
      });
    }

    const trimmedMsg = message.trim();
    const txHash = (transaction_hash || '').trim();

    if (status === 'approved') {
      // Approve withdrawal
      await connection.query(`
        UPDATE withdraw_transactions
        SET 
          status = 'approved',
          payment_status = 'completed',
          comment = ?,
          transaction_hash = COALESCE(NULLIF(?, ''), transaction_hash),
          updated_at = NOW()
        WHERE id = ?
      `, [trimmedMsg, txHash, id]);

      await connection.commit();

      return res.json({
        success: true,
        message: 'Withdrawal approved successfully.',
        data: { id, status: 'approved', comment: trimmedMsg, transaction_hash: txHash },
      });
    } else {
      // Reject withdrawal: Refund amount to user wallet (matching Laravel lines 3420-3426)
      await connection.query(`
        UPDATE withdraw_transactions
        SET 
          status = 'rejected',
          payment_status = 'failed',
          comment = ?,
          updated_at = NOW()
        WHERE id = ?
      `, [trimmedMsg, id]);

      // Refund to wallet:
      // If withdraw_wallet is donation_wallet, refund to donation_wallet; otherwise to main balance
      const refundField = withdraw.withdraw_wallet === 'donation_wallet' ? 'donation_wallet' : 'balance';
      
      const [walletCheck]: any = await connection.query(`
        SELECT * FROM user_wallets WHERE user_id = ? FOR UPDATE
      `, [withdraw.user_id]);

      if (walletCheck && walletCheck.length > 0) {
        await connection.query(`
          UPDATE user_wallets
          SET ${refundField} = ${refundField} + ?, updated_at = NOW()
          WHERE user_id = ?
        `, [withdraw.total_amount, withdraw.user_id]);
      } else {
        // Create wallet row if missing
        await connection.query(`
          INSERT INTO user_wallets (user_id, balance, donation_wallet, created_at, updated_at)
          VALUES (?, ?, ?, NOW(), NOW())
        `, [
          withdraw.user_id,
          refundField === 'balance' ? withdraw.total_amount : 0,
          refundField === 'donation_wallet' ? withdraw.total_amount : 0,
        ]);
      }

      await connection.commit();

      return res.json({
        success: true,
        message: `Withdrawal rejected and $${withdraw.total_amount.toFixed(2)} refunded to user's wallet successfully.`,
        data: { id, status: 'rejected', comment: trimmedMsg, refundedAmount: withdraw.total_amount },
      });
    }
  } catch (error: any) {
    await connection.rollback();
    console.error('Error in processWithdrawal:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
