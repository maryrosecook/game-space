import path from 'node:path';

import { headers } from 'next/headers';

import { HomepageApp } from './shared/components/HomepageApp';
import { buildHomepagePageData } from './shared/homepagePageData';
import {
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv
} from '../services/adminAuth';
import { listGameVersions } from '../services/gameVersions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const authConfig = readAdminAuthConfigFromEnv();
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie') ?? undefined;
  const isAdmin = await isAdminAuthenticatedFromCookieHeader(cookieHeader, authConfig);
  const versions = await listGameVersions(path.join(process.cwd(), 'games'));
  const homepageData = buildHomepagePageData(versions, { isAdmin });

  return <HomepageApp data={homepageData} />;
}
