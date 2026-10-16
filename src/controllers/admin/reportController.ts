import { Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * GET /api/admin/reports/summary
 * Returns overview statistics across all report categories
 */
export const getReportsSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 1. Referral commission totals
    const [[refRow]]: any = await pool.query(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
      FROM incomes WHERE type = 'R'
    `);

    // 2. Level commission totals
    const [[lvlRow]]: any = await pool.query(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
      FROM incomes WHERE type = 'Level'
    `);

    // 3. Rank reward totals (from rank_rewards where status = 'approved')
    const [[rankRow]]: any = await pool.query(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(reward_amount), 0) as total
      FROM rank_rewards WHERE status = 'approved'
    `);

    // 4. All transactions totals
    const [[transRow]]: any = await pool.query(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
      FROM transactions
    `);

    return res.json({
      success: true,
      data: {
        referral: {
          count: Number(refRow?.cnt || 0),
          amount: parseFloat(refRow?.total || 0),
        },
        level: {
          count: Number(lvlRow?.cnt || 0),
          amount: parseFloat(lvlRow?.total || 0),
        },
        rankReward: {
          count: Number(rankRow?.cnt || 0),
          amount: parseFloat(rankRow?.total || 0),
        },
        transactions: {
          count: Number(transRow?.cnt || 0),
          amount: parseFloat(transRow?.total || 0),
        },
      },
    });
  } catch (error: any) {
    console.error('[Reports Summary Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/reports/referral
 * Matches Laravel admin_referral_commission_report & ajax_admin_referral_commission_report
 */
export const getReferralCommissionReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["i.type = 'R'"];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR fu.username LIKE ? OR fu.email LIKE ? OR t.trans_id LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total count & total sum
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(i.id) as total,
        COALESCE(SUM(i.amount), 0) as total_amount
      FROM incomes i
      LEFT JOIN transactions t ON t.income_id = i.id AND (t.type = 'R' OR t.transaction_type = 'referral_commission')
      LEFT JOIN users u ON u.id = i.user_id
      LEFT JOIN users fu ON fu.id = i.from_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const totalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch records
    const [rows]: any = await pool.query(`
      SELECT 
        i.id,
        COALESCE(t.trans_id, CONCAT('TXR-', i.id)) as trans_id,
        i.user_id,
        i.from_id,
        i.amount,
        i.perc,
        i.level,
        i.net_amount,
        i.description,
        i.created_at,
        u.username as user_username,
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        fu.username as from_username,
        fu.first_name as from_first_name,
        fu.last_name as from_last_name
      FROM incomes i
      LEFT JOIN transactions t ON t.income_id = i.id AND (t.type = 'R' OR t.transaction_type = 'referral_commission')
      LEFT JOIN users u ON u.id = i.user_id
      LEFT JOIN users fu ON fu.id = i.from_id
      ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id,
      user_id: row.user_id,
      username: row.user_username || String(row.user_id),
      fullname: row.user_first_name ? `${row.user_first_name} ${row.user_last_name || ''}`.trim() : row.user_username || '-',
      from_user_id: row.from_id,
      from_username: row.from_username || (row.from_id ? String(row.from_id) : '-'),
      from_fullname: row.from_first_name ? `${row.from_first_name} ${row.from_last_name || ''}`.trim() : row.from_username || '-',
      perc: row.perc ? `${row.perc}%` : '8%',
      level: row.level ? `Level ${row.level}` : 'Level 1',
      amount: parseFloat(row.amount || 0),
      description: row.description || `Direct referral commission (${row.perc || 8}%)`,
      date: row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: totalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[Referral Commission Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/reports/level
 * Matches Laravel admin_level_commission_report & ajax_admin_level_commission_report
 */
export const getLevelCommissionReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["i.type = 'Level'"];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR fu.username LIKE ? OR fu.email LIKE ? OR t.trans_id LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total count & total sum
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(i.id) as total,
        COALESCE(SUM(i.amount), 0) as total_amount
      FROM incomes i
      LEFT JOIN transactions t ON t.income_id = i.id AND (t.type = 'Level' OR t.transaction_type = 'level_commission')
      LEFT JOIN users u ON u.id = i.user_id
      LEFT JOIN users fu ON fu.id = i.from_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const totalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch records
    const [rows]: any = await pool.query(`
      SELECT 
        i.id,
        COALESCE(t.trans_id, CONCAT('TXL-', i.id)) as trans_id,
        i.user_id,
        i.from_id,
        i.amount,
        i.perc,
        i.level,
        i.description,
        i.created_at,
        u.username as user_username,
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        fu.username as from_username,
        fu.first_name as from_first_name,
        fu.last_name as from_last_name
      FROM incomes i
      LEFT JOIN transactions t ON t.income_id = i.id AND (t.type = 'Level' OR t.transaction_type = 'level_commission')
      LEFT JOIN users u ON u.id = i.user_id
      LEFT JOIN users fu ON fu.id = i.from_id
      ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id,
      user_id: row.user_id,
      username: row.user_username || String(row.user_id),
      fullname: row.user_first_name ? `${row.user_first_name} ${row.user_last_name || ''}`.trim() : row.user_username || '-',
      from_user_id: row.from_id,
      from_username: row.from_username || (row.from_id ? String(row.from_id) : '-'),
      from_fullname: row.from_first_name ? `${row.from_first_name} ${row.from_last_name || ''}`.trim() : row.from_username || '-',
      perc: row.perc ? `${row.perc}%` : '-',
      level: row.level ? `Level ${row.level}` : '-',
      amount: parseFloat(row.amount || 0),
      description: row.description || `Level ${row.level || 1} commission (${row.perc || 0}%)`,
      date: row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: totalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[Level Commission Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/reports/rank-reward
 * Matches Laravel admin_rank_reward_report & ajax_admin_rank_reward_report
 * Reports distributed rank awards and bonuses
 */
export const getRankRewardReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["rr.status = 'approved'"];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR rr.rank_name LIKE ? OR rr.reward_name LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total count & total sum
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(rr.id) as total,
        COALESCE(SUM(rr.reward_amount), 0) as total_amount
      FROM rank_rewards rr
      LEFT JOIN users u ON u.id = rr.user_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const totalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch records
    const [rows]: any = await pool.query(`
      SELECT 
        rr.id,
        COALESCE(rr.trans_id, CONCAT('RNK-', rr.id)) as trans_id,
        rr.user_id,
        rr.reward_amount as amount,
        rr.reward_name,
        rr.rank_name,
        rr.status,
        rr.updated_at,
        rr.created_at,
        u.username,
        u.first_name,
        u.last_name
      FROM rank_rewards rr
      LEFT JOIN users u ON u.id = rr.user_id
      ${whereClause}
      ORDER BY rr.updated_at DESC, rr.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id,
      user_id: row.user_id,
      username: row.username || String(row.user_id),
      fullname: row.first_name ? `${row.first_name} ${row.last_name || ''}`.trim() : row.username || '-',
      rank_name: row.rank_name || 'Rank Award',
      reward_name: row.reward_name || 'Cash Bonus',
      amount: parseFloat(row.amount || 0),
      status: row.status,
      description: `${row.rank_name || 'Rank'} Achievement Award: ${row.reward_name || 'Reward'}`,
      date: row.updated_at || row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: totalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[Rank Reward Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/reports/transactions
 * Matches Laravel admin_all_transactions & ajax_admin_all_transactions
 * Master Transaction Ledger across the platform
 */
export const getAllTransactionsReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uname = (req.query.uname as string || req.query.search as string || '').trim();
    const type = (req.query.type as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (uname) {
      conditions.push("(u.username LIKE ? OR u.email LIKE ? OR t.trans_id LIKE ? OR t.remarks LIKE ? OR t.description LIKE ?)");
      const term = `%${uname}%`;
      params.push(term, term, term, term, term);
    }

    if (type) {
      conditions.push("t.transaction_type = ?");
      params.push(type);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 1. Total count & total sum
    const [countRows]: any = await pool.query(`
      SELECT 
        COUNT(t.id) as total,
        COALESCE(SUM(t.amount), 0) as total_amount
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
    `, params);

    const totalRecords = Number(countRows[0]?.total || 0);
    const totalAmount = parseFloat(countRows[0]?.total_amount || 0);

    // 2. Fetch records
    const [rows]: any = await pool.query(`
      SELECT 
        t.id,
        t.trans_id,
        t.user_id,
        t.amount,
        t.charge,
        t.new_balance,
        t.type,
        t.transaction_type,
        t.remarks,
        t.description,
        t.created_at,
        u.username,
        u.first_name,
        u.last_name,
        u.email
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedData = rows.map((row: any) => ({
      id: row.id,
      trans_id: row.trans_id || `TX-${row.id}`,
      user_id: row.user_id,
      username: row.username || String(row.user_id),
      fullname: row.first_name ? `${row.first_name} ${row.last_name || ''}`.trim() : row.username || '-',
      amount: parseFloat(row.amount || 0),
      charge: parseFloat(row.charge || 0),
      new_balance: parseFloat(row.new_balance || 0),
      transaction_type: row.transaction_type || row.type || 'transaction',
      remarks: row.remarks || '-',
      description: row.description || row.remarks || '-',
      date: row.created_at,
    }));

    return res.json({
      success: true,
      data: formattedData,
      total_amount: totalAmount,
      meta: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error: any) {
    console.error('[All Transactions Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
