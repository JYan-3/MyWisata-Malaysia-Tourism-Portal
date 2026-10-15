import 'server-only';

import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential } from '@simplewebauthn/server';
import type { StaffPasskeyConfig } from './staff-passkey-config';

export function authenticationOptions(config: StaffPasskeyConfig, credentials: Pick<WebAuthnCredential, 'id' | 'transports'>[]) {
  return generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required', allowCredentials: credentials });
}

export function registrationOptions(config: StaffPasskeyConfig, name: string, userHandle: string, credentials: Pick<WebAuthnCredential, 'id' | 'transports'>[]) {
  return generateRegistrationOptions({ rpID: config.rpID, rpName: config.rpName, userName: name, userID: new Uint8Array(Buffer.from(userHandle, 'base64url')), attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: credentials });
}

export async function verifyStaffAuthentication(config: StaffPasskeyConfig, challenge: string, response: AuthenticationResponseJSON, credential: WebAuthnCredential) {
  if (response.id !== credential.id) throw new Error('Credential ownership mismatch');
  return verifyAuthenticationResponse({ response, credential, expectedChallenge: challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true });
}

export function verifyStaffRegistration(config: StaffPasskeyConfig, challenge: string, response: RegistrationResponseJSON) {
  return verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true, requireUserPresence: true });
}
