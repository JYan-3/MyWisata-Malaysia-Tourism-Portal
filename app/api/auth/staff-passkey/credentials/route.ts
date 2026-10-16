import { staffCredentialList, staffCredentialRevoke } from '@/lib/auth/staff-passkey-flow';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = staffCredentialList;
export const DELETE = staffCredentialRevoke;
