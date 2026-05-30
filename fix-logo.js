/**
 * Ensures the official ABSU logo is present in public/assets/images/.
 * Place absu-logo.png (university shield) in that folder — do not generate placeholders.
 */
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, 'public', 'assets', 'images', 'absu-logo.png');

if (!fs.existsSync(logoPath)) {
  console.error('❌ Missing public/assets/images/absu-logo.png');
  console.error('   Add the official Abia State University Uturu logo as absu-logo.png');
  process.exit(1);
}

const stat = fs.statSync(logoPath);
console.log(`✅ Logo found: absu-logo.png (${Math.round(stat.size / 1024)} KB)`);
console.log('   To strip a baked-in white/checkerboard background, run: node scripts/remove-logo-background.js');
