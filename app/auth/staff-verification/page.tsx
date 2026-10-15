"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { StaffPasskey } from '@/components/admin/staff-passkey';
import { safeStaffVerificationNext } from '@/lib/auth/staff-route-boundaries';
import { AuthPageShell } from '@/components/shared/auth-page-shell';

function StaffVerification() {
  const { t } = useTranslation('admin');
  const params = useSearchParams();
  const next = safeStaffVerificationNext(params.get('next'));
  return <AuthPageShell title={t('passkey.title')} description={t('passkey.description')}><StaffPasskey embedded onVerified={() => { window.location.assign(next); }} /></AuthPageShell>;
}

export default function StaffVerificationPage() {
  return <Suspense><StaffVerification /></Suspense>;
}
