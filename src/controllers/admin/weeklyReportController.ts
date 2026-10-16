import { Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

interface WeekRange {
  fromStr: string;
  toStr: string;
  fromSql: string;
  toSql: string;
  formattedLabel: string;
}

/**
 * Resolves Monday-Sunday week range based on input date,
 * with fallback to the latest record's week if current week has no data.
 */
async function resolveWeekRange(fromDateStr?: string, toDateStr?: string): Promise<WeekRange> {
  const toYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const formatHuman = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // 1. If explicit dates are provided
  if (fromDateStr || toDateStr) {
    const raw = fromDateStr || toDateStr!;
    const parts = raw.split('-').map(Number);
    const anchor = new Date(parts[0], parts[1] - 1, parts[2]);

    const day = anchor.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + diffToMon, 0, 0, 0);
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59);

    return {
      fromStr: toYMD(mon),
      toStr: toYMD(sun),
      fromSql: `${toYMD(mon)} 00:00:00`,
      toSql: `${toYMD(sun)} 23:59:59`,
      formattedLabel: `${formatHuman(mon)} – ${formatHuman(sun)}`,
    };
  }

  // 2. Default: Current week Mon-Sun
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  let mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon, 0, 0, 0);
  let sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59);

  const curFromSql = `${toYMD(mon)} 00:00:00`;
  const curToSql = `${toYMD(sun)} 23:59:59`;

  // Check if current week has data across deposits, transactions, or donation_matches
  const [[depCheck]]: any = await pool.query(
    `SELECT id FROM deposits WHERE status = 'approved' AND created_at BETWEEN ? AND ? LIMIT 1`,
    [curFromSql, curToSql]
  );
  const [[txCheck]]: any = await pool.query(
    `SELECT id FROM transactions WHERE (type = 'Epin_Purchase' OR transaction_type = 'epin_buy') AND created_at BETWEEN ? AND ? LIMIT 1`,
    [curFromSql, curToSql]
  );
  const [[dmCheck]]: any = await pool.query(
    `SELECT id FROM donation_matches WHERE created_at BETWEEN ? AND ? LIMIT 1`,
    [curFromSql, curToSql]
  );

  const hasData = Boolean(depCheck || txCheck || dmCheck);

  if (!hasData) {
    // Fallback: Find latest recorded date across all 3 tables
    const [[maxDep]]: any = await pool.query(`SELECT MAX(created_at) as m FROM deposits WHERE status = 'approved'`);
    const [[maxTx]]: any = await pool.query(`SELECT MAX(created_at) as m FROM transactions WHERE type = 'Epin_Purchase' OR transaction_type = 'epin_buy'`);
    const [[maxDm]]: any = await pool.query(`SELECT MAX(created_at) as m FROM donation_matches`);

    const dates = [maxDep?.m, maxTx?.m, maxDm?.m]
      .filter(Boolean)
      .map((d) => new Date(d).getTime());

    if (dates.length > 0) {
      const maxTimestamp = Math.max(...dates);
      const latest = new Date(maxTimestamp);
      const lDay = latest.getDay();
      const lDiff = lDay === 0 ? -6 : 1 - lDay;
      mon = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + lDiff, 0, 0, 0);
      sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59);
    }
  }

  return {
    fromStr: toYMD(mon),
    toStr: toYMD(sun),
    fromSql: `${toYMD(mon)} 00:00:00`,
    toSql: `${toYMD(sun)} 23:59:59`,
    formattedLabel: `${formatHuman(mon)} – ${formatHuman(sun)}`,
  };
}

/**
 * GET /api/admin/weekly-report
 * Retrieves full summary metrics and paginated records for the selected week.
 */
export const getWeeklyReport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const fromDate = (req.query.from_date as string || '').trim();
    const toDate = (req.query.to_date as string || '').trim();
    const userId = (req.query.user_id as string || req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string || req.query.rows as string) || 20));
    const offset = (page - 1) * limit;
    const activeTab = (req.query.tab as string || 'donate').toLowerCase();

    const week = await resolveWeekRange(fromDate, toDate);

    // ── 1. Summary Metrics ───────────────────────────────────────────────────────
    // A. Deposits
    let depSumSql = `
      SELECT COUNT(d.id) as cnt, COALESCE(SUM(d.amount), 0) as total
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      WHERE d.status = 'approved' AND d.created_at BETWEEN ? AND ?
    `;
    const depSumParams: any[] = [week.fromSql, week.toSql];
    if (userId) {
      depSumSql += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
      const term = `%${userId}%`;
      depSumParams.push(term, term);
    }
    const [[depSummary]]: any = await pool.query(depSumSql, depSumParams);

    // B. Credit Purchases (Epin_Purchase)
    let cpSumSql = `
      SELECT COUNT(t.id) as cnt, COALESCE(SUM(t.amount), 0) as total
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      WHERE (t.type = 'Epin_Purchase' OR t.transaction_type = 'epin_buy')
        AND t.created_at BETWEEN ? AND ?
    `;
    const cpSumParams: any[] = [week.fromSql, week.toSql];
    if (userId) {
      cpSumSql += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
      const term = `%${userId}%`;
      cpSumParams.push(term, term);
    }
    const [[cpSummary]]: any = await pool.query(cpSumSql, cpSumParams);

    // C. Make Donations (Donation Matches)
    let mdSumSql = `
      SELECT COUNT(dm.id) as cnt, COALESCE(SUM(dm.amount), 0) as total
      FROM donation_matches dm
      LEFT JOIN users s ON s.id = dm.sender_id
      LEFT JOIN users r ON r.id = dm.receiver_id
      WHERE dm.created_at BETWEEN ? AND ?
    `;
    const mdSumParams: any[] = [week.fromSql, week.toSql];
    if (userId) {
      mdSumSql += ` AND (s.username LIKE ? OR s.email LIKE ? OR r.username LIKE ? OR r.email LIKE ?)`;
      const term = `%${userId}%`;
      mdSumParams.push(term, term, term, term);
    }
    const [[mdSummary]]: any = await pool.query(mdSumSql, mdSumParams);

    const summary = {
      from: week.fromStr,
      to: week.toStr,
      formattedLabel: week.formattedLabel,
      userId,
      deposits: {
        count: Number(depSummary?.cnt || 0),
        amount: parseFloat(depSummary?.total || 0),
      },
      creditPurchases: {
        count: Number(cpSummary?.cnt || 0),
        amount: parseFloat(cpSummary?.total || 0),
      },
      makeDonations: {
        count: Number(mdSummary?.cnt || 0),
        amount: parseFloat(mdSummary?.total || 0),
      },
    };

    // ── 2. Tab Data Query ────────────────────────────────────────────────────────
    let tableData: any[] = [];
    let totalCount = 0;

    if (activeTab === 'credits' || activeTab === 'credit-purchases') {
      totalCount = summary.creditPurchases.count;

      let cpQuery = `
        SELECT 
          t.id,
          t.trans_id,
          t.user_id,
          t.amount,
          t.created_at,
          u.username,
          u.first_name,
          u.last_name
        FROM transactions t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE (t.type = 'Epin_Purchase' OR t.transaction_type = 'epin_buy')
          AND t.created_at BETWEEN ? AND ?
      `;
      const cpParams: any[] = [week.fromSql, week.toSql];
      if (userId) {
        cpQuery += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
        const term = `%${userId}%`;
        cpParams.push(term, term);
      }
      cpQuery += ` ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`;
      cpParams.push(limit, offset);

      const [cpRows]: any = await pool.query(cpQuery, cpParams);
      tableData = cpRows.map((r: any) => ({
        id: r.id,
        trans_id: r.trans_id || `CP-${r.id}`,
        user_id: r.user_id,
        username: r.username || `User #${r.user_id}`,
        fullname: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : r.username || '-',
        amount: parseFloat(r.amount || 0),
        status: 'Completed',
        date: r.created_at,
      }));
    } else if (activeTab === 'matches' || activeTab === 'make-donations') {
      totalCount = summary.makeDonations.count;

      let mdQuery = `
        SELECT 
          dm.id,
          dm.sender_id,
          dm.receiver_id,
          dm.amount,
          dm.reference_no,
          dm.transaction_hash,
          dm.status,
          dm.created_at,
          s.username as sender_username,
          s.first_name as sender_first_name,
          s.last_name as sender_last_name,
          r.username as receiver_username,
          r.first_name as receiver_first_name,
          r.last_name as receiver_last_name
        FROM donation_matches dm
        LEFT JOIN users s ON s.id = dm.sender_id
        LEFT JOIN users r ON r.id = dm.receiver_id
        WHERE dm.created_at BETWEEN ? AND ?
      `;
      const mdParams: any[] = [week.fromSql, week.toSql];
      if (userId) {
        mdQuery += ` AND (s.username LIKE ? OR s.email LIKE ? OR r.username LIKE ? OR r.email LIKE ?)`;
        const term = `%${userId}%`;
        mdParams.push(term, term, term, term);
      }
      mdQuery += ` ORDER BY dm.created_at DESC, dm.id DESC LIMIT ? OFFSET ?`;
      mdParams.push(limit, offset);

      const [mdRows]: any = await pool.query(mdQuery, mdParams);
      tableData = mdRows.map((r: any) => ({
        id: r.id,
        sender_id: r.sender_id,
        sender_username: r.sender_username || `User #${r.sender_id}`,
        sender_fullname: r.sender_first_name ? `${r.sender_first_name} ${r.sender_last_name || ''}`.trim() : r.sender_username || '-',
        receiver_id: r.receiver_id,
        receiver_username: r.receiver_username || `User #${r.receiver_id}`,
        receiver_fullname: r.receiver_first_name ? `${r.receiver_first_name} ${r.receiver_last_name || ''}`.trim() : r.receiver_username || '-',
        amount: parseFloat(r.amount || 0),
        reference_no: r.reference_no || `DM-${r.id}`,
        transaction_hash: r.transaction_hash,
        status: r.status,
        date: r.created_at,
      }));
    } else {
      // Default: Donate (Deposits where status = 'approved')
      totalCount = summary.deposits.count;

      let depQuery = `
        SELECT 
          d.id,
          d.user_id,
          d.amount,
          d.transaction_hash,
          d.status,
          d.created_at,
          u.username,
          u.first_name,
          u.last_name
        FROM deposits d
        LEFT JOIN users u ON u.id = d.user_id
        WHERE d.status = 'approved' AND d.created_at BETWEEN ? AND ?
      `;
      const depParams: any[] = [week.fromSql, week.toSql];
      if (userId) {
        depQuery += ` AND (u.username LIKE ? OR u.email LIKE ?)`;
        const term = `%${userId}%`;
        depParams.push(term, term);
      }
      depQuery += ` ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`;
      depParams.push(limit, offset);

      const [depRows]: any = await pool.query(depQuery, depParams);
      tableData = depRows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username || `User #${r.user_id}`,
        fullname: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : r.username || '-',
        amount: parseFloat(r.amount || 0),
        transaction_hash: r.transaction_hash,
        status: r.status || 'approved',
        date: r.created_at,
      }));
    }

    return res.json({
      success: true,
      summary,
      tab: activeTab,
      data: tableData,
      meta: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (error: any) {
    console.error('[Weekly Report Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
