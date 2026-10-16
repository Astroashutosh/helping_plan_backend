import { Request, Response } from 'express';
import { pool } from '../../config/db.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

/**
 * Utility: Parse reward options JSON/string into a clean array of strings
 * (Mirrors Laravel RankService::parseRewardOptions)
 */
export function parseRewardOptions(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(String).map(s => s.trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const flattened = parsed.flat(Infinity);
      const options = flattened.map(String).map(s => s.trim()).filter(Boolean);
      return Array.from(new Set(options));
    }
  } catch {
    // Fallback split
  }
  const cleaned = trimmed.replace(/[\[\]{}"']/g, '');
  const parts = cleaned.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(parts));
}

/**
 * GET /api/admin/rank-rewards
 * Fetch rank rewards with server-side filtering, search, pagination, and counts.
 * (Mirrors Laravel RankRewardController@pending, unclaimed, approved, rejected)
 */
export async function getRankRewards(req: Request, res: Response): Promise<void> {
  try {
    const tab = String(req.query.tab || req.query.type || 'pending').toLowerCase(); // 'pending', 'unclaimed', 'approved', 'rejected'
    const search = String(req.query.search || req.query.uname || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || req.query.rows || '50'), 10)));
    const offset = (page - 1) * limit;

    // 1. Calculate summary counts for tabs (matching Laravel getCounts())
    const [countsRows]: any = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END), 0) as requested_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as unclaimed_count,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) as approved_count,
        COALESCE(SUM(CASE WHEN (response LIKE '%rejection_history%' OR status = 'rejected') THEN 1 ELSE 0 END), 0) as rejected_count,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN reward_amount ELSE 0 END), 0) as total_cash_given
      FROM rank_rewards
    `);

    const c = countsRows[0] || {};
    const counts = {
      requested_count: Number(c.requested_count) || 0,
      unclaimed_count: Number(c.unclaimed_count) || 0,
      approved_count: Number(c.approved_count) || 0,
      rejected_count: Number(c.rejected_count) || 0,
      total_cash_given: Number(c.total_cash_given) || 0,
    };

    // 2. Build WHERE conditions based on tab
    const whereConditions: string[] = [];
    const queryParams: any[] = [];

    if (tab === 'pending') {
      whereConditions.push("rr.status = 'requested'");
    } else if (tab === 'unclaimed') {
      whereConditions.push("rr.status = 'pending'");
    } else if (tab === 'approved') {
      whereConditions.push("rr.status = 'approved'");
    } else if (tab === 'rejected') {
      whereConditions.push("(rr.response LIKE '%rejection_history%' OR rr.status = 'rejected')");
    }

    // Search filter
    if (search) {
      whereConditions.push(`(
        u.username LIKE ? OR
        rr.trans_id LIKE ? OR
        rr.rank_name LIKE ? OR
        rr.reward_name LIKE ? OR
        CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) LIKE ?
      )`);
      const term = `%${search}%`;
      queryParams.push(term, term, term, term, term);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 3. Count total records matching filter
    const [countResult]: any = await pool.query(`
      SELECT COUNT(*) as total
      FROM rank_rewards rr
      LEFT JOIN users u ON u.id = rr.user_id
      ${whereClause}
    `, queryParams);

    const total = Number(countResult[0]?.total) || 0;

    // 4. Fetch paginated rows
    // Default order: updated_at DESC (pending/approved/rejected) or id DESC (unclaimed)
    const orderSql = tab === 'unclaimed' ? 'rr.id DESC' : 'rr.updated_at DESC, rr.id DESC';

    const [rows]: any = await pool.query(`
      SELECT 
        rr.id,
        rr.user_id,
        rr.rank_id,
        rr.rank_name,
        rr.reward_amount,
        rr.reward_name,
        rr.trans_id,
        rr.commission_earned,
        rr.directs_count,
        rr.response,
        rr.reward_options,
        rr.status,
        rr.created_at,
        rr.updated_at,
        u.username,
        u.first_name,
        u.last_name,
        u.email
      FROM rank_rewards rr
      LEFT JOIN users u ON u.id = rr.user_id
      ${whereClause}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset]);

    res.json({
      success: true,
      counts,
      data: rows.map((r: any, idx: number) => {
        const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || '-';
        
        let parsedResponse: any = {};
        if (r.response) {
          try {
            parsedResponse = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
          } catch {
            parsedResponse = {};
          }
        }

        const parsedOptions = parseRewardOptions(r.reward_options);
        const rejectionHistory = parsedResponse.rejection_history || [];
        const lastRejection = parsedResponse.last_rejection || null;

        return {
          id: r.id,
          srNo: offset + idx + 1,
          userId: r.user_id,
          username: r.username || `User #${r.user_id}`,
          fullName,
          email: r.email || '',
          rankId: r.rank_id,
          rankName: r.rank_name,
          rewardAmount: Number(r.reward_amount) || 0,
          rewardName: r.reward_name || null,
          transId: r.trans_id,
          commissionEarned: Number(r.commission_earned) || 0,
          directsCount: Number(r.directs_count) || 0,
          rewardOptions: parsedOptions,
          rawRewardOptions: r.reward_options,
          status: r.status,
          response: parsedResponse,
          approvedBy: parsedResponse.approved_by || 'Admin',
          approvedAt: parsedResponse.approved_at || null,
          adminNotes: parsedResponse.admin_notes || null,
          rejectionHistory,
          lastRejection,
          declinedItem: lastRejection?.declined_item || r.reward_name || 'Reward Option',
          declineReason: lastRejection?.reason || '-',
          rejectedBy: lastRejection?.rejected_by || 'Admin',
          rejectedAt: lastRejection?.rejected_at || null,
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
    console.error('[RankRewardController] getRankRewards error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch rank rewards' });
  }
}

/**
 * POST /api/admin/rank-rewards/:id/approve
 * Approve a rank reward claim (with ability to customize or select the reward option).
 * (Mirrors Laravel RankRewardController@approve)
 */
export async function approveRankReward(req: AuthenticatedRequest, res: Response): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const rewardId = parseInt(String(req.params.id), 10);
    const { reward_name, admin_notes } = req.body;
    const adminUser = req.admin?.username || 'Admin';

    if (!rewardId) {
      res.status(400).json({ success: false, message: 'Invalid reward ID' });
      return;
    }

    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      'SELECT id, user_id, trans_id, rank_name, reward_name, reward_options, response, status FROM rank_rewards WHERE id = ? FOR UPDATE',
      [rewardId]
    );

    if (!rows || rows.length === 0) {
      await conn.rollback();
      res.status(404).json({ success: false, message: 'Rank reward not found' });
      return;
    }

    const reward = rows[0];

    if (reward.status === 'approved') {
      await conn.rollback();
      res.status(400).json({ success: false, message: 'This rank reward has already been approved.' });
      return;
    }

    // Determine final reward name
    let finalRewardName = reward.reward_name;
    if (reward_name && typeof reward_name === 'string' && reward_name.trim()) {
      finalRewardName = reward_name.trim();
    } else if (!finalRewardName) {
      const opts = parseRewardOptions(reward.reward_options);
      finalRewardName = opts[0] || `${reward.rank_name} Leadership Gift`;
    }

    // Parse existing response
    let existingResponse: any = {};
    if (reward.response) {
      try {
        existingResponse = typeof reward.response === 'string' ? JSON.parse(reward.response) : reward.response;
      } catch {
        existingResponse = {};
      }
    }

    existingResponse.approved_by = adminUser;
    existingResponse.approved_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
    if (admin_notes && typeof admin_notes === 'string' && admin_notes.trim()) {
      existingResponse.admin_notes = admin_notes.trim();
    }

    // Update rank_rewards
    await conn.query(
      `UPDATE rank_rewards SET
        reward_name = ?,
        status = 'approved',
        response = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [finalRewardName, JSON.stringify(existingResponse), rewardId]
    );

    // Update transaction remarks if trans_id is present
    if (reward.trans_id) {
      await conn.query(
        `UPDATE transactions SET 
          remarks = ?, 
          updated_at = NOW() 
        WHERE trans_id = ?`,
        [`Rank Reward Approved: ${finalRewardName} (Rank: ${reward.rank_name})`, reward.trans_id]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: `Rank reward for ${reward.rank_name} (#${reward.trans_id}) approved successfully with item '${finalRewardName}'!`,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error('[RankRewardController] approveRankReward error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to approve rank reward' });
  } finally {
    conn.release();
  }
}

/**
 * POST /api/admin/rank-rewards/:id/reject
 * Reject a rank reward claim (Option A: Reopen for user to select alternative gift with audit log).
 * (Mirrors Laravel RankRewardController@reject)
 */
export async function rejectRankReward(req: AuthenticatedRequest, res: Response): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const rewardId = parseInt(String(req.params.id), 10);
    const { reason } = req.body;
    const adminUser = req.admin?.username || 'Admin';

    if (!rewardId) {
      res.status(400).json({ success: false, message: 'Invalid reward ID' });
      return;
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(422).json({ success: false, message: 'Please provide a reason for rejecting this claim.' });
      return;
    }

    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      'SELECT id, user_id, trans_id, rank_name, reward_name, response, status FROM rank_rewards WHERE id = ? FOR UPDATE',
      [rewardId]
    );

    if (!rows || rows.length === 0) {
      await conn.rollback();
      res.status(404).json({ success: false, message: 'Rank reward not found' });
      return;
    }

    const reward = rows[0];

    if (reward.status === 'approved') {
      await conn.rollback();
      res.status(400).json({ success: false, message: 'Cannot reject an already approved reward.' });
      return;
    }

    const declinedItem = reward.reward_name || 'Reward Choice';

    let existingResponse: any = {};
    if (reward.response) {
      try {
        existingResponse = typeof reward.response === 'string' ? JSON.parse(reward.response) : reward.response;
      } catch {
        existingResponse = {};
      }
    }

    const history = existingResponse.rejection_history || [];
    const rejectionEntry = {
      declined_item: declinedItem,
      rejected_by: adminUser,
      rejected_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
      reason: reason.trim(),
    };
    history.push(rejectionEntry);
    existingResponse.rejection_history = history;
    existingResponse.last_rejection = rejectionEntry;

    // Option A: Reset status back to 'pending' and clear reward_name so member can pick another gift
    await conn.query(
      `UPDATE rank_rewards SET
        reward_name = NULL,
        status = 'pending',
        response = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [JSON.stringify(existingResponse), rewardId]
    );

    if (reward.trans_id) {
      await conn.query(
        `UPDATE transactions SET
          remarks = ?,
          updated_at = NOW()
        WHERE trans_id = ?`,
        [`Claim for '${declinedItem}' rejected by Admin: ${reason.trim()}. Reopened for member to choose alternative gift.`, reward.trans_id]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: `Claim for '${declinedItem}' was rejected with reason: '${reason.trim()}'. Reopened for member to choose alternative gift.`,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error('[RankRewardController] rejectRankReward error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to reject rank reward' });
  } finally {
    conn.release();
  }
}
