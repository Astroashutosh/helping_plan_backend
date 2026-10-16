import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * GET /api/admin/deposits
 * Fetch deposits with server-side filtering, search, pagination, and summary statistics.
 * (Mirrors Laravel DepositManagementController@ajaxPendingDeposits and ajaxAllDeposits)
 */
export async function getDeposits(req: Request, res: Response): Promise<void> {
  try {
    const type = String(req.query.type || 'all').toLowerCase(); // 'pending' or 'all'
    const statusParam = req.query.status ? String(req.query.status).toLowerCase() : '';
    const search = String(req.query.search || req.query.uname || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || req.query.rows || '15'), 10)));
    const offset = (page - 1) * limit;

    // 1. Calculate overall stats (matching Laravel allDeposits cards)
    const [statsRows]: any = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as total_approved_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved_count,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) as rejected_count,
        COUNT(*) as total_count
      FROM deposits
    `);

    const stats = statsRows[0] || {};
    const summaryStats = {
      totalApprovedAmount: Number(stats.total_approved_amount) || 0,
      pendingCount: Number(stats.pending_count) || 0,
      approvedCount: Number(stats.approved_count) || 0,
      rejectedCount: Number(stats.rejected_count) || 0,
      totalCount: Number(stats.total_count) || 0,
    };

    // 2. Build WHERE filters
    const whereConditions: string[] = [];
    const queryParams: any[] = [];

    // Filter by type or statusParam
    if (type === 'pending') {
      whereConditions.push("d.status = 'pending'");
    } else if (statusParam && statusParam !== 'all') {
      whereConditions.push('d.status = ?');
      queryParams.push(statusParam);
    }

    // Search by username, user ID, trans_id, transaction_hash
    if (search) {
      whereConditions.push(`(
        u.username LIKE ? OR
        d.trans_id LIKE ? OR
        d.transaction_hash LIKE ? OR
        CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      queryParams.push(term, term, term, term);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 3. Count total records matching filter
    const [countRows]: any = await pool.query(`
      SELECT COUNT(*) as total
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      ${whereClause}
    `, queryParams);

    const total = Number(countRows[0]?.total) || 0;

    // 4. Fetch paginated records with user details
    const [rows]: any = await pool.query(`
      SELECT 
        d.id,
        d.user_id,
        d.trans_id,
        d.transaction_hash,
        d.amount,
        d.rate,
        d.myr_amount,
        d.action,
        d.method,
        d.wallet,
        d.status,
        d.payment_reciept,
        d.payment_mode,
        d.approved_by,
        d.reject_reason,
        d.created_at,
        d.updated_at,
        u.username,
        u.first_name,
        u.last_name,
        u.email
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      ${whereClause}
      ORDER BY d.id DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset]);

    res.json({
      success: true,
      stats: summaryStats,
      data: rows.map((r: any, idx: number) => {
        const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || '-';
        return {
          id: r.id,
          srNo: offset + idx + 1,
          userId: r.user_id,
          username: r.username || `User #${r.user_id}`,
          fullName,
          email: r.email || '',
          transId: r.trans_id,
          amount: Number(r.amount) || 0,
          rate: Number(r.rate) || 1,
          myrAmount: Number(r.myr_amount) || 0,
          method: r.method || 'USDT (BEP-20)',
          wallet: r.wallet || 'deposit_wallet',
          paymentMode: r.payment_mode || 'blockchain',
          transactionHash: r.transaction_hash || null,
          paymentReceipt: r.payment_reciept || null,
          receiptUrl: r.payment_reciept ? `/uploads/deposits/${r.payment_reciept}` : null,
          status: r.status,
          approvedBy: r.approved_by,
          rejectReason: r.reject_reason || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('[DepositController] getDeposits error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch deposits' });
  }
}

/**
 * POST /api/admin/deposits/:id/approve
 * Approve a pending deposit and credit user's Deposit Wallet
 * (Mirrors Laravel DepositManagementController@approve)
 */
export async function approveDeposit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const depositId = parseInt(String(req.params.id), 10);
    const adminId = req.admin?.id || 1;

    if (!depositId) {
      res.status(400).json({ success: false, message: 'Invalid deposit ID' });
      return;
    }

    await conn.beginTransaction();

    // 1. Fetch deposit record with lock
    const [depRows]: any = await conn.query(
      'SELECT id, user_id, trans_id, amount, status, transaction_hash FROM deposits WHERE id = ? FOR UPDATE',
      [depositId]
    );

    if (!depRows || depRows.length === 0) {
      await conn.rollback();
      res.status(404).json({ success: false, message: 'Donate request not found' });
      return;
    }

    const deposit = depRows[0];
    if (deposit.status !== 'pending') {
      await conn.rollback();
      res.status(400).json({
        success: false,
        message: `This Donate is already marked as ${deposit.status}.`,
      });
      return;
    }

    const amount = Number(deposit.amount) || 0;

    // 2. Mark deposit as approved
    await conn.query(
      `UPDATE deposits SET 
        status = 'approved',
        approved_by = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [adminId, depositId]
    );

    // 3. Credit user's Deposit Wallet
    const [walletRows]: any = await conn.query(
      'SELECT id, deposit_balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [deposit.user_id]
    );

    let newDepositBalance = amount;
    if (walletRows && walletRows.length > 0) {
      newDepositBalance = (Number(walletRows[0].deposit_balance) || 0) + amount;
      await conn.query(
        'UPDATE user_wallets SET deposit_balance = ?, updated_at = NOW() WHERE user_id = ?',
        [newDepositBalance, deposit.user_id]
      );
    } else {
      await conn.query(
        `INSERT INTO user_wallets (user_id, balance, deposit_balance, donation_wallet, donation_withdrawable, total_earning, created_at, updated_at)
         VALUES (?, 0, ?, 0, 0, 0, NOW(), NOW())`,
        [deposit.user_id, amount]
      );
    }

    // 4. Create Transaction Ledger record (Matching Laravel)
    await conn.query(`
      INSERT INTO transactions (
        user_id,
        trans_id,
        amount,
        charge,
        new_balance,
        type,
        transaction_type,
        remarks,
        description,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 0, ?, 'deposit', 'manual_deposit_approved', ?, ?, NOW(), NOW())
    `, [
      deposit.user_id,
      deposit.trans_id,
      amount,
      newDepositBalance,
      `Manual Deposit of $${amount.toFixed(2)} USDT approved by Admin #${adminId}`,
      `Funds credited to Donate Wallet (TXID: ${deposit.transaction_hash || '-'})`,
    ]);

    await conn.commit();

    const successMsg = `Donate #${deposit.trans_id} of $${amount.toFixed(2)} approved! Funds credited to user's Donate Wallet.`;
    res.json({
      success: true,
      valid: 1,
      message: successMsg,
      msg: successMsg,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error('[DepositController] approveDeposit error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to approve deposit' });
  } finally {
    conn.release();
  }
}

/**
 * POST /api/admin/deposits/:id/reject
 * Reject a pending deposit with reason
 * (Mirrors Laravel DepositManagementController@reject)
 */
export async function rejectDeposit(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const depositId = parseInt(String(req.params.id), 10);
    const adminId = req.admin?.id || 1;
    const reason = String(req.body.reason || '').trim();

    if (!depositId) {
      res.status(400).json({ success: false, message: 'Invalid deposit ID' });
      return;
    }

    if (!reason) {
      res.status(400).json({ success: false, message: 'Please provide a reason for rejecting this Donate request.' });
      return;
    }

    const [depRows]: any = await pool.query(
      'SELECT id, trans_id, status FROM deposits WHERE id = ? LIMIT 1',
      [depositId]
    );

    if (!depRows || depRows.length === 0) {
      res.status(404).json({ success: false, message: 'Donate request not found' });
      return;
    }

    const deposit = depRows[0];
    if (deposit.status !== 'pending') {
      res.status(400).json({
        success: false,
        message: `This Donate is already marked as ${deposit.status}.`,
      });
      return;
    }

    await pool.query(
      `UPDATE deposits SET 
        status = 'rejected',
        reject_reason = ?,
        approved_by = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [reason, adminId, depositId]
    );

    const successMsg = `Donate #${deposit.trans_id} rejected successfully.`;
    res.json({
      success: true,
      valid: 1,
      message: successMsg,
      msg: successMsg,
    });
  } catch (error: any) {
    console.error('[DepositController] rejectDeposit error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to reject deposit' });
  }
}
