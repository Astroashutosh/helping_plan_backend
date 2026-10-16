import path from 'path';
import fs from 'fs';

/**
 * Dynamic resolution of primary uploads directory:
 * Defaults to './uploads' relative to process.cwd() (entirely inside the backend folder).
 */
export function getUploadsBaseDir(): string {
  const dir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), 'uploads');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Path for package badge uploads under backend/uploads/package
 */
export function getPackageUploadsDir(): string {
  const base = getUploadsBaseDir();
  const pkgDir = path.join(base, 'package');
  if (!fs.existsSync(pkgDir)) {
    fs.mkdirSync(pkgDir, { recursive: true });
  }
  return pkgDir;
}

/**
 * Path for user profile avatar uploads under backend/uploads/user
 */
export function getUserUploadsDir(): string {
  const base = getUploadsBaseDir();
  const userDir = path.join(base, 'user');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

/**
 * Path for academy courses, documents, and content uploads under backend/uploads/academy/...
 */
export function getAcademyUploadsDir(sub: 'courses' | 'documents' | 'contents' = 'courses'): string {
  const base = getUploadsBaseDir();
  const dir = path.join(base, 'academy', sub);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}


