"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// La redirección al paso de 2FA la maneja el formulario de login con el router de Next.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
