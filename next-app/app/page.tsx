import path from 'node:path';

import { headers } from 'next/headers';

import { HomepageApp } from '../../src/react/components/HomepageApp';
import { buildHomepagePageData } from '../../src/react/homepagePageData';
import {
  isAdminAuthenticatedFromCookieHeader,
  readAdminAuthConfigFromEnv
} from '../../src/services/adminAuth';
import { listGameVersions } from '../../src/services/gameVersions';

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
