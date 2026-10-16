import { Response } from 'express';
import { pool } from '../../config/db.js';
import path from 'path';
import fs from 'fs';
import { getAcademyUploadsDir } from '../../config/uploadConfig.js';
import type { AuthenticatedRequest } from '../../middlewares/authMiddleware.js';

function getParamId(param: string | string[] | undefined): number {
  if (Array.isArray(param)) return parseInt(param[0], 10) || 0;
  return parseInt(param || '0', 10) || 0;
}

/**
 * Generate URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Save base64 image or document to uploads directory
 */
function saveBase64Media(
  base64Data: string,
  subDir: 'courses' | 'documents' | 'contents' = 'courses',
  prefix = 'media'
): string | null {
  try {
    const matches = base64Data.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    let ext = 'png';

    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('pdf')) ext = 'pdf';
    else if (mimeType.includes('mp4')) ext = 'mp4';
    else if (mimeType.includes('word') || mimeType.includes('doc')) ext = 'docx';
    else if (mimeType.includes('excel') || mimeType.includes('sheet') || mimeType.includes('xls')) ext = 'xlsx';
    else if (mimeType.includes('presentation') || mimeType.includes('powerpoint') || mimeType.includes('ppt')) ext = 'pptx';

    const fileName = `${Date.now()}_${prefix}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const targetDir = getAcademyUploadsDir(subDir);
    fs.writeFileSync(path.join(targetDir, fileName), buffer);

    return `uploads/academy/${subDir}/${fileName}`;
  } catch (err) {
    console.error('[Academy Media Save Error]', err);
    return null;
  }
}

// ============================================================================
// 1. ACADEMY CATEGORIES
// ============================================================================

/**
 * GET /api/admin/academy/categories
 * Retrieves all categories with parent names and courses count
 */
export const getCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT 
        c.id,
        c.parent_id,
        c.title,
        c.slug,
        c.status,
        c.created_at,
        c.updated_at,
        p.title as parent_title,
        (SELECT COUNT(*) FROM academy_courses ac WHERE ac.category_id = c.id OR ac.sub_category_id = c.id) as courses_count,
        (SELECT COUNT(*) FROM academy_categories sc WHERE sc.parent_id = c.id) as subcategories_count
      FROM academy_categories c
      LEFT JOIN academy_categories p ON p.id = c.parent_id
      ORDER BY COALESCE(c.parent_id, c.id) ASC, c.parent_id ASC, c.id ASC
    `);

    const categories = rows.map((r: any) => ({
      id: r.id,
      parent_id: r.parent_id,
      parent_title: r.parent_title || null,
      title: r.title,
      slug: r.slug,
      status: Number(r.status),
      courses_count: Number(r.courses_count || 0),
      subcategories_count: Number(r.subcategories_count || 0),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.json({
      success: true,
      data: categories,
    });
  } catch (error: any) {
    console.error('[Get Categories Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/academy/categories/parents
 * Retrieves top-level parent categories for dropdowns
 */
export const getParentCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT id, title, slug, status
      FROM academy_categories
      WHERE parent_id IS NULL AND status = 1
      ORDER BY title ASC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error('[Get Parent Categories Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/academy/categories/subcategories
 * Retrieves sub-categories for a given parent_id
 */
export const getSubcategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parentId = parseInt(req.query.parent_id as string);
    if (!parentId) {
      return res.json({ success: true, data: [] });
    }

    const [rows]: any = await pool.query(`
      SELECT id, title, slug, status
      FROM academy_categories
      WHERE parent_id = ? AND status = 1
      ORDER BY title ASC
    `, [parentId]);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    console.error('[Get Subcategories Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/academy/categories
 * Create a new category
 */
export const createCategory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, parent_id, slug, status } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Category title is required.' });
    }

    const parentIdVal = parent_id ? parseInt(parent_id) : null;

    // Check if parent is a top-level category
    if (parentIdVal) {
      const [[parent]]: any = await pool.query(
        'SELECT id, parent_id FROM academy_categories WHERE id = ?',
        [parentIdVal]
      );
      if (!parent) {
        return res.status(400).json({ success: false, message: 'Parent category not found.' });
      }
      if (parent.parent_id !== null) {
        return res.status(400).json({
          success: false,
          message: 'Only a top-level category can have sub-categories. A sub-category cannot be a parent.',
        });
      }
    }

    let finalSlug = slug ? slugify(slug) : slugify(title);
    if (!finalSlug) finalSlug = `category-${Date.now()}`;

    // Ensure uniqueness of slug
    let uniqueSlug = finalSlug;
    let counter = 1;
    while (true) {
      const [[exists]]: any = await pool.query(
        'SELECT id FROM academy_categories WHERE slug = ? LIMIT 1',
        [uniqueSlug]
      );
      if (!exists) break;
      uniqueSlug = `${finalSlug}-${counter++}`;
    }

    const categoryStatus = status !== undefined ? (Number(status) ? 1 : 0) : 1;

    const [result]: any = await pool.query(`
      INSERT INTO academy_categories (parent_id, title, slug, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `, [parentIdVal, title.trim(), uniqueSlug, categoryStatus]);

    return res.json({
      success: true,
      message: 'Academy category created successfully.',
      id: result.insertId,
    });
  } catch (error: any) {
    console.error('[Create Category Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/academy/categories/:id
 * Update category
 */
export const updateCategory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);
    const { title, parent_id, slug, status } = req.body;

    const [[category]]: any = await pool.query(
      'SELECT id, parent_id, title FROM academy_categories WHERE id = ?',
      [id]
    );
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Category title is required.' });
    }

    const parentIdVal = parent_id ? parseInt(parent_id) : null;

    if (parentIdVal && parentIdVal === id) {
      return res.status(400).json({ success: false, message: 'A category cannot be its own parent.' });
    }

    if (parentIdVal) {
      // Check if current category already has subcategories
      const [[subCount]]: any = await pool.query(
        'SELECT COUNT(*) as cnt FROM academy_categories WHERE parent_id = ?',
        [id]
      );
      if (Number(subCount?.cnt || 0) > 0) {
        return res.status(400).json({
          success: false,
          message: 'This category already has sub-categories, so it cannot be made a sub-category itself.',
        });
      }

      // Check if selected parent is top-level
      const [[targetParent]]: any = await pool.query(
        'SELECT id, parent_id FROM academy_categories WHERE id = ?',
        [parentIdVal]
      );
      if (!targetParent || targetParent.parent_id !== null) {
        return res.status(400).json({
          success: false,
          message: 'Only a top-level category can be selected as a parent category.',
        });
      }
    }

    let finalSlug = slug ? slugify(slug) : slugify(title);
    if (!finalSlug) finalSlug = `category-${Date.now()}`;

    // Ensure slug is unique excluding this category
    let uniqueSlug = finalSlug;
    let counter = 1;
    while (true) {
      const [[exists]]: any = await pool.query(
        'SELECT id FROM academy_categories WHERE slug = ? AND id != ? LIMIT 1',
        [uniqueSlug, id]
      );
      if (!exists) break;
      uniqueSlug = `${finalSlug}-${counter++}`;
    }

    const categoryStatus = status !== undefined ? (Number(status) ? 1 : 0) : 1;

    await pool.query(`
      UPDATE academy_categories
      SET parent_id = ?, title = ?, slug = ?, status = ?, updated_at = NOW()
      WHERE id = ?
    `, [parentIdVal, title.trim(), uniqueSlug, categoryStatus, id]);

    return res.json({
      success: true,
      message: 'Academy category updated successfully.',
    });
  } catch (error: any) {
    console.error('[Update Category Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/admin/academy/categories/:id/status
 * Toggle category active status
 */
export const toggleCategoryStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);
    const [[category]]: any = await pool.query(
      'SELECT id, status FROM academy_categories WHERE id = ?',
      [id]
    );
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const newStatus = category.status ? 0 : 1;
    await pool.query(
      'UPDATE academy_categories SET status = ?, updated_at = NOW() WHERE id = ?',
      [newStatus, id]
    );

    return res.json({
      success: true,
      message: 'Category status updated successfully.',
      status: newStatus,
    });
  } catch (error: any) {
    console.error('[Toggle Category Status Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/admin/academy/categories/:id
 * Delete category (if no courses linked)
 */
export const deleteCategory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);

    // Check linked courses
    const [[courseCheck]]: any = await pool.query(`
      SELECT COUNT(*) as cnt FROM academy_courses
      WHERE category_id = ? OR sub_category_id = ?
    `, [id, id]);

    if (Number(courseCheck?.cnt || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete: courses are linked to this category.',
      });
    }

    // Check linked subcategories
    const [[subCheck]]: any = await pool.query(`
      SELECT COUNT(*) as cnt FROM academy_categories WHERE parent_id = ?
    `, [id]);

    if (Number(subCheck?.cnt || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete: this category has sub-categories. Please delete or reassign them first.',
      });
    }

    await pool.query('DELETE FROM academy_categories WHERE id = ?', [id]);

    return res.json({
      success: true,
      message: 'Academy category deleted successfully.',
    });
  } catch (error: any) {
    console.error('[Delete Category Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 2. ACADEMY COURSES
// ============================================================================

/**
 * GET /api/admin/academy/courses
 * List courses with category names, documents count, and filters
 */
export const getCourses = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim();
    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string) : null;
    const status = req.query.status !== undefined && req.query.status !== '' ? parseInt(req.query.status as string) : null;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (search) {
      conditions.push('(ac.title LIKE ? OR ac.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (categoryId) {
      conditions.push('(ac.category_id = ? OR ac.sub_category_id = ?)');
      params.push(categoryId, categoryId);
    }

    if (status !== null) {
      conditions.push('ac.status = ?');
      params.push(status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Total count
    const [[countRow]]: any = await pool.query(`
      SELECT COUNT(*) as total FROM academy_courses ac ${whereClause}
    `, params);
    const total = Number(countRow?.total || 0);

    // Fetch courses
    const [rows]: any = await pool.query(`
      SELECT 
        ac.id,
        ac.category_id,
        ac.sub_category_id,
        ac.title,
        ac.slug,
        ac.description,
        ac.image,
        ac.duration,
        ac.price,
        ac.status,
        ac.created_at,
        ac.updated_at,
        cat.title as category_title,
        sub.title as subcategory_title,
        (SELECT COUNT(*) FROM academy_documents ad WHERE ad.course_id = ac.id) as documents_count,
        (SELECT COUNT(*) FROM academy_course_contents acc WHERE acc.course_id = ac.id) as contents_count
      FROM academy_courses ac
      LEFT JOIN academy_categories cat ON cat.id = ac.category_id
      LEFT JOIN academy_categories sub ON sub.id = ac.sub_category_id
      ${whereClause}
      ORDER BY ac.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const courses = rows.map((r: any) => ({
      id: r.id,
      category_id: r.category_id,
      sub_category_id: r.sub_category_id,
      category_title: r.category_title || '-',
      subcategory_title: r.subcategory_title || '-',
      title: r.title,
      slug: r.slug,
      description: r.description,
      image: r.image,
      duration: r.duration || '-',
      price: parseFloat(r.price || 0),
      status: Number(r.status),
      documents_count: Number(r.documents_count || 0),
      contents_count: Number(r.contents_count || 0),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.json({
      success: true,
      data: courses,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error: any) {
    console.error('[Get Courses Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/academy/courses/:id
 * Retrieve detailed course data including documents and video contents
 */
export const getCourseDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);

    const [[course]]: any = await pool.query(`
      SELECT 
        ac.id,
        ac.category_id,
        ac.sub_category_id,
        ac.title,
        ac.slug,
        ac.description,
        ac.image,
        ac.duration,
        ac.price,
        ac.status,
        ac.created_at,
        ac.updated_at,
        cat.title as category_title,
        sub.title as subcategory_title
      FROM academy_courses ac
      LEFT JOIN academy_categories cat ON cat.id = ac.category_id
      LEFT JOIN academy_categories sub ON sub.id = ac.sub_category_id
      WHERE ac.id = ?
    `, [id]);

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    // Documents
    const [documents]: any = await pool.query(`
      SELECT id, course_id, title, file, created_at
      FROM academy_documents
      WHERE course_id = ?
      ORDER BY id ASC
    `, [id]);

    // Contents (Videos / Lessons)
    const [contents]: any = await pool.query(`
      SELECT id, course_id, title, type, file, url, status, created_at
      FROM academy_course_contents
      WHERE course_id = ?
      ORDER BY id ASC
    `, [id]);

    return res.json({
      success: true,
      data: {
        ...course,
        price: parseFloat(course.price || 0),
        status: Number(course.status),
        documents,
        contents,
      },
    });
  } catch (error: any) {
    console.error('[Get Course Details Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/academy/courses
 * Create new course with optional media and contents
 */
export const createCourse = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      category_id,
      sub_category_id,
      title,
      description,
      price,
      duration,
      status,
      image,
      documents,
      contents,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Course title is required.' });
    }
    if (!category_id) {
      return res.status(400).json({ success: false, message: 'Category is required.' });
    }

    let finalSlug = slugify(title);
    if (!finalSlug) finalSlug = `course-${Date.now()}`;

    // Ensure unique slug
    let uniqueSlug = finalSlug;
    let counter = 1;
    while (true) {
      const [[exists]]: any = await pool.query(
        'SELECT id FROM academy_courses WHERE slug = ? LIMIT 1',
        [uniqueSlug]
      );
      if (!exists) break;
      uniqueSlug = `${finalSlug}-${counter++}`;
    }

    let imagePath: string | null = null;
    if (image && image.startsWith('data:')) {
      imagePath = saveBase64Media(image, 'courses', 'course');
    } else if (image && typeof image === 'string') {
      imagePath = image;
    }

    const courseStatus = status !== undefined ? (Number(status) ? 1 : 0) : 1;
    const coursePrice = price !== undefined ? parseFloat(price) : 0;
    const subCatId = sub_category_id ? parseInt(sub_category_id) : null;

    const [result]: any = await pool.query(`
      INSERT INTO academy_courses (
        category_id, sub_category_id, title, slug, description, image, duration, price, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      parseInt(category_id),
      subCatId,
      title.trim(),
      uniqueSlug,
      description || '',
      imagePath,
      duration || null,
      coursePrice,
      courseStatus,
    ]);

    const courseId = result.insertId;

    // Save initial documents if provided
    if (Array.isArray(documents) && documents.length > 0) {
      for (const doc of documents) {
        if (!doc.title) continue;
        let docPath: string | null = null;
        if (doc.file && doc.file.startsWith('data:')) {
          docPath = saveBase64Media(doc.file, 'documents', 'doc');
        } else if (doc.file) {
          docPath = doc.file;
        }

        if (docPath) {
          await pool.query(`
            INSERT INTO academy_documents (course_id, title, file, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
          `, [courseId, doc.title.trim(), docPath]);
        }
      }
    }

    // Save initial contents (video lessons) if provided
    if (Array.isArray(contents) && contents.length > 0) {
      for (const item of contents) {
        if (!item.title) continue;
        const itemType = item.type || 'video';
        let itemFilePath: string | null = null;

        if (item.file && item.file.startsWith('data:')) {
          itemFilePath = saveBase64Media(item.file, 'contents', 'content');
        } else if (item.file) {
          itemFilePath = item.file;
        }

        await pool.query(`
          INSERT INTO academy_course_contents (
            course_id, title, type, file, url, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          courseId,
          item.title.trim(),
          itemType,
          itemFilePath,
          item.url ? item.url.trim() : null,
          item.status !== undefined ? (Number(item.status) ? 1 : 0) : 1,
        ]);
      }
    }

    return res.json({
      success: true,
      message: 'Academy course created successfully.',
      id: courseId,
    });
  } catch (error: any) {
    console.error('[Create Course Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/academy/courses/:id
 * Update course details, documents, and contents
 */
export const updateCourse = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);
    const [[existing]]: any = await pool.query(
      'SELECT id, image FROM academy_courses WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    const {
      category_id,
      sub_category_id,
      title,
      description,
      price,
      duration,
      status,
      image,
      documents,
      contents,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Course title is required.' });
    }

    let imagePath = existing.image;
    if (image && image.startsWith('data:')) {
      imagePath = saveBase64Media(image, 'courses', 'course');
    } else if (image && typeof image === 'string') {
      imagePath = image;
    }

    const courseStatus = status !== undefined ? (Number(status) ? 1 : 0) : 1;
    const coursePrice = price !== undefined ? parseFloat(price) : 0;
    const subCatId = sub_category_id ? parseInt(sub_category_id) : null;

    let finalSlug = slugify(title);
    if (!finalSlug) finalSlug = `course-${Date.now()}`;

    // Ensure slug uniqueness
    let uniqueSlug = finalSlug;
    let counter = 1;
    while (true) {
      const [[slugExists]]: any = await pool.query(
        'SELECT id FROM academy_courses WHERE slug = ? AND id != ? LIMIT 1',
        [uniqueSlug, id]
      );
      if (!slugExists) break;
      uniqueSlug = `${finalSlug}-${counter++}`;
    }

    await pool.query(`
      UPDATE academy_courses
      SET 
        category_id = ?,
        sub_category_id = ?,
        title = ?,
        slug = ?,
        description = ?,
        image = ?,
        duration = ?,
        price = ?,
        status = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [
      parseInt(category_id),
      subCatId,
      title.trim(),
      uniqueSlug,
      description || '',
      imagePath,
      duration || null,
      coursePrice,
      courseStatus,
      id,
    ]);

    // Handle documents if provided
    if (Array.isArray(documents)) {
      for (const doc of documents) {
        if (!doc.title) continue;
        if (doc.id) {
          // Update existing doc title
          await pool.query(
            'UPDATE academy_documents SET title = ?, updated_at = NOW() WHERE id = ? AND course_id = ?',
            [doc.title.trim(), doc.id, id]
          );
        } else if (doc.file) {
          let docPath = doc.file;
          if (doc.file.startsWith('data:')) {
            docPath = saveBase64Media(doc.file, 'documents', 'doc');
          }
          if (docPath) {
            await pool.query(`
              INSERT INTO academy_documents (course_id, title, file, created_at, updated_at)
              VALUES (?, ?, ?, NOW(), NOW())
            `, [id, doc.title.trim(), docPath]);
          }
        }
      }
    }

    // Handle contents (video lessons) if provided
    if (Array.isArray(contents)) {
      for (const item of contents) {
        if (!item.title) continue;
        if (item.id) {
          await pool.query(`
            UPDATE academy_course_contents
            SET title = ?, type = ?, url = ?, status = ?, updated_at = NOW()
            WHERE id = ? AND course_id = ?
          `, [
            item.title.trim(),
            item.type || 'video',
            item.url ? item.url.trim() : null,
            item.status !== undefined ? (Number(item.status) ? 1 : 0) : 1,
            item.id,
            id,
          ]);
        } else {
          let contentFilePath = null;
          if (item.file && item.file.startsWith('data:')) {
            contentFilePath = saveBase64Media(item.file, 'contents', 'content');
          } else if (item.file) {
            contentFilePath = item.file;
          }

          await pool.query(`
            INSERT INTO academy_course_contents (
              course_id, title, type, file, url, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
          `, [
            id,
            item.title.trim(),
            item.type || 'video',
            contentFilePath,
            item.url ? item.url.trim() : null,
            item.status !== undefined ? (Number(item.status) ? 1 : 0) : 1,
          ]);
        }
      }
    }

    return res.json({
      success: true,
      message: 'Academy course updated successfully.',
    });
  } catch (error: any) {
    console.error('[Update Course Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/admin/academy/courses/:id/status
 * Toggle course status
 */
export const toggleCourseStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);
    const [[course]]: any = await pool.query(
      'SELECT id, status FROM academy_courses WHERE id = ?',
      [id]
    );
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    const newStatus = course.status ? 0 : 1;
    await pool.query(
      'UPDATE academy_courses SET status = ?, updated_at = NOW() WHERE id = ?',
      [newStatus, id]
    );

    return res.json({
      success: true,
      message: 'Course status updated successfully.',
      status: newStatus,
    });
  } catch (error: any) {
    console.error('[Toggle Course Status Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/admin/academy/courses/:id
 * Delete course and all linked records
 */
export const deleteCourse = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getParamId(req.params.id);

    // Delete sub-records first
    await pool.query('DELETE FROM academy_course_purchases WHERE course_id = ?', [id]);
    await pool.query('DELETE FROM academy_documents WHERE course_id = ?', [id]);
    await pool.query('DELETE FROM academy_course_contents WHERE course_id = ?', [id]);
    await pool.query('DELETE FROM academy_courses WHERE id = ?', [id]);

    return res.json({
      success: true,
      message: 'Academy course deleted successfully.',
    });
  } catch (error: any) {
    console.error('[Delete Course Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/admin/academy/documents/:docId
 * Delete a specific course document
 */
export const deleteCourseDocument = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const docId = getParamId(req.params.docId);
    await pool.query('DELETE FROM academy_documents WHERE id = ?', [docId]);

    return res.json({
      success: true,
      message: 'Course document removed successfully.',
    });
  } catch (error: any) {
    console.error('[Delete Document Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/admin/academy/contents/:contentId
 * Delete a specific lesson / content item
 */
export const deleteCourseContent = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contentId = getParamId(req.params.contentId);
    await pool.query('DELETE FROM academy_course_contents WHERE id = ?', [contentId]);

    return res.json({
      success: true,
      message: 'Course content removed successfully.',
    });
  } catch (error: any) {
    console.error('[Delete Content Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 3. ACADEMY PURCHASES / ENROLLMENTS
// ============================================================================

/**
 * GET /api/admin/academy/purchases
 * List course purchases
 */
export const getCoursePurchases = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(5, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['1=1'];
    const params: any[] = [];

    if (search) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR ac.title LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const [[countRow]]: any = await pool.query(`
      SELECT COUNT(p.id) as total, COALESCE(SUM(p.amount), 0) as total_amount
      FROM academy_course_purchases p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN academy_courses ac ON ac.id = p.course_id
      ${whereClause}
    `, params);

    const total = Number(countRow?.total || 0);
    const totalAmount = parseFloat(countRow?.total_amount || 0);

    const [rows]: any = await pool.query(`
      SELECT 
        p.id,
        p.course_id,
        p.user_id,
        p.amount,
        p.payment_status,
        p.payment_id,
        p.status,
        p.created_at,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        ac.title as course_title,
        ac.price as course_price
      FROM academy_course_purchases p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN academy_courses ac ON ac.id = p.course_id
      ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const purchases = rows.map((r: any) => ({
      id: r.id,
      course_id: r.course_id,
      course_title: r.course_title || 'OpenAid Course',
      user_id: r.user_id,
      username: r.username || `User #${r.user_id}`,
      fullname: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : r.username || '-',
      email: r.email,
      amount: parseFloat(r.amount || 0),
      payment_status: r.payment_status || 'completed',
      payment_id: r.payment_id,
      status: Number(r.status),
      created_at: r.created_at,
    }));

    return res.json({
      success: true,
      data: purchases,
      total_amount: totalAmount,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error: any) {
    console.error('[Get Course Purchases Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
