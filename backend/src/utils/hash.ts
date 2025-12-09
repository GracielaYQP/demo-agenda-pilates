import * as bcrypt from 'bcryptjs';

async function hashPass() {
  const hashed = await bcrypt.hash('Lcarsofi123#', 15);
  console.log('Hash:', hashed);
}

hashPass();

