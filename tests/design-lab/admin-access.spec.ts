import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const documents = 'http://127.0.0.1:8080/v1/projects/demo-avalon-manager/databases/(default)/documents';
const headers = { Authorization: 'Bearer owner' }; // Local synthetic Emulator only.

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  execFileSync(process.execPath, ['scripts/reset-demo.mjs'], { cwd: projectRoot, stdio: 'inherit' });
});

test('stored master can register and remove an ordinary administrator through the real UI', async ({ page, request }) => {
  const email = 'new.operator@example.test';
  await page.goto('/settings');
  await expect(page.getByText('로컬 데모 관리자')).toBeVisible();
  await expect(page.getByRole('heading', { name: '관리자 (Admin) 권한 설정' })).toBeVisible();
  await page.getByPlaceholder('구글 이메일 주소 (예: user@gmail.com)').fill(email.toUpperCase());
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const remove = page.getByRole('button', { name: `${email} 관리자 권한 삭제` });
  await expect(remove).toBeVisible();
  const response = await request.get(`${documents}/admins/${email}`, { headers });
  expect(response.ok()).toBe(true);
  const record = await response.json();
  expect(record.fields.role.stringValue).toBe('admin');
  expect(record.fields.email.stringValue).toBe(email);
  await expect(page.getByRole('button', { name: 'demo.admin@avalon.local 관리자 권한 삭제' })).toHaveCount(0);
  await remove.click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(remove).toHaveCount(0);
  expect((await request.get(`${documents}/admins/${email}`, { headers })).status()).toBe(404);
});

test('regular operator settings stay usable without requesting the master-only administrator list', async ({ page, request }) => {
  const response = await request.patch(`${documents}/admins/demo.admin@avalon.local?updateMask.fieldPaths=role`, {
    headers, data: { fields: { role: { stringValue: 'admin' } } },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '설정 및 내보내기' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '관리자 (Admin) 권한 설정' })).toHaveCount(0);
  await expect(page.getByText('관리자 목록을 불러오지 못했습니다.')).toHaveCount(0);
});
