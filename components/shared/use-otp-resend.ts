"use client";

import { useEffect, useState } from "react";

/** The existing invitation OTP countdown, shared by every phone verification form. */
export function useOtpResend() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}
