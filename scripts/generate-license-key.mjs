import { generateLicenseKey, hashLicenseKey } from '../src-server/licenseKeys.js';

const key = generateLicenseKey();
console.log(`Activation key: ${key}`);
console.log(`SHA-256 hash:  ${hashLicenseKey(key)}`);
