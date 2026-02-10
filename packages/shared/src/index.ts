export * from "./types";
export * from "./merge";
export * from "./shamir";

import { deriveKeyFromPassword, deriveSubKey, encrypt, decrypt } from "./crypto";

export { deriveKeyFromPassword, deriveSubKey, encrypt, decrypt };
