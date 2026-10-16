import { Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * Utility to parse human-readable payment method from transaction remarks/description
 * Matches Laravel AdminController.php lines 2240-2297
 */
function parsePaymentMethod(remarks: string = '', description: string = ''): string {
  const rem = (remarks || '').toLowerCase();
  const desc = (description || '').toLowerCase();
  const combined = `${rem} ${desc}`;

  if (combined.includes('deposit wallet')) return 'Deposit Wallet';
  if (combined.includes('main wallet') || combined.includes('main balance')) return 'Main Wallet';
  if (combined.includes('withdrawal wallet')) return 'Withdrawal Wallet';
  if (combined.includes('usdt')) return 'USDT';
  if (combined.includes('busd')) return 'BUSD';
  if (combined.includes('usdc')) return 'USDC';
  if (combined.includes('wallet')) return 'Wallet';
  return 'Deposit Wallet';
}

/**
 * Utility to format donation transaction type
 */
function formatDonationType(txType: string): string {
  switch (txType) {
    case 'donation_deposit_wallet':
      return 'Deposit Wallet';
    case 'donation_balance':
      return 'Main Balance';
    case 'donation_usdt':
      return 'USDT (Direct)';
    case 'recommit_donation':
      return 'Recommit Donation';
    case 'donation_earning_wallet':
      return 'Earning Wallet';
    case 'donation_income_wallet':
      return 'Income Wallet';
    default:
      return txType ? txType.replace(/_/g, ' ').toUpperCase() : 'Donation';
  }
}

/**
 * GET /api/admin/purchase-donation/summary
 * Returns top-level summary metrics for credit purchases and donations
 */
export const getPurchaseDonationSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [[creditRow]]: any = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(amount), 0) as total_amount
      FROM transactions
      WHERE transaction_type = 'epin_buy'
    `);

    const [[donationRow]]: any = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(amount), 0) as total_amount
      FROM transactions
      WHERE transaction_type IN ('donation_usdt', 'donation_earning_wallet', 'donation_income_wallet', 'donation_deposit_wallet', 'donation_balance', 'recommit_donation')
    `);

    return res.json({
      success: true,
      data: {
        creditPurchases: {
          count: Number(creditRow?.total_count || 0),
          amount: parseFloat(creditRow?.total_amount || 0),
        },
        donations: {
          count: Number(donationRow?.total_count || 0),
          amount: parseFloat(donationRow?.total_amount || 0),
        },
      },
    });
  } catch (error: any) {
    console.error('[PurchaseDonation Summary Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/purchase-donation/credit-purchases
 * Matches Laravel admin_epin_purchase_report & ajax_admin_epin_purchase_report
 */
export const getCreditPurchasesReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 10));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["t.transaction_type = 'epin_buy'"];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR t.trans_id LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total Count & Sum of filtered records
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(t.amount), 0) as total_amount
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const filteredTotalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch Paginated Records
    const [rows]: any = await pool.query(`
      SELECT 
        t.id,
        t.trans_id,
        t.user_id,
        t.amount,
        t.charge,
        t.remarks,
        t.description,
        t.transaction_type,
        t.created_at,
        u.username,
        u.email,
        u.first_name,
        u.last_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id || '-',
      user_id: row.user_id,
      username: row.username || '-',
      fullname: row.first_name ? `${row.first_name} ${row.last_name || ''}`.trim() : row.username || '-',
      email: row.email || '-',
      amount: parseFloat(row.amount || 0),
      payment_method: parsePaymentMethod(row.remarks, row.description),
      remarks: row.remarks || '-',
      description: row.description || '-',
      date: row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: filteredTotalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[Credit Purchases Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/purchase-donation/donations
 * Matches Laravel admin_make_donation_report & ajax_admin_make_donation_report
 */
export const getDonationsReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 10));
    const offset = (page - 1) * limit;

    const donationTypes = [
      'donation_usdt',
      'donation_earning_wallet',
      'donation_income_wallet',
      'donation_deposit_wallet',
      'donation_balance',
      'recommit_donation',
    ];

    const conditions: string[] = [`t.transaction_type IN (${donationTypes.map(d => `'${d}'`).join(',')})`];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR t.trans_id LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total Count & Sum of filtered records
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(t.amount), 0) as total_amount
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const filteredTotalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch Paginated Records
    const [rows]: any = await pool.query(`
      SELECT 
        t.id,
        t.trans_id,
        t.user_id,
        t.amount,
        t.charge,
        t.remarks,
        t.description,
        t.transaction_type,
        t.created_at,
        u.username,
        u.email,
        u.first_name,
        u.last_name
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id || '-',
      user_id: row.user_id,
      username: row.username || '-',
      fullname: row.first_name ? `${row.first_name} ${row.last_name || ''}`.trim() : row.username || '-',
      email: row.email || '-',
      amount: parseFloat(row.amount || 0),
      transaction_type: row.transaction_type,
      donation_type: formatDonationType(row.transaction_type),
      remarks: row.remarks || '-',
      description: row.description || '-',
      date: row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: filteredTotalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[Donations Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
