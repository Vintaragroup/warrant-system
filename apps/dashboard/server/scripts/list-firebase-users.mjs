#!/usr/bin/env node
import '../src/config/loadEnv.js';
import { firebaseAuth } from '../src/lib/firebaseAdmin.js';

async function main() {
  try {
    console.log('Fetching all Firebase users...\n');
    
    let pageToken;
    let userCount = 0;
    const users = [];

    do {
      const result = await firebaseAuth.listUsers(1000, pageToken);
      
      for (const user of result.users) {
        userCount++;
        const providerData = user.providerData || [];
        const providers = providerData.map(p => p.providerId).join(', ') || 'email/password';
        
        users.push({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || '(none)',
          emailVerified: user.emailVerified,
          disabled: user.disabled,
          providers: providers,
          createdAt: new Date(user.metadata?.creationTime).toISOString(),
          lastSignInTime: user.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : '(never)',
        });
      }
      
      pageToken = result.pageToken;
    } while (pageToken);

    console.log(`Total Firebase users: ${userCount}\n`);
    console.table(users);
    
    // Summary for ryan@vintaragroup.com
    console.log('\n=== Summary ===');
    const ryanUsers = users.filter(u => u.email === 'ryan@vintaragroup.com');
    
    if (ryanUsers.length === 0) {
      console.log('❌ No user found for ryan@vintaragroup.com');
    } else {
      console.log(`✅ Found ${ryanUsers.length} login(s) for ryan@vintaragroup.com:`);
      ryanUsers.forEach((u, i) => {
        console.log(`\n  Login #${i + 1}:`);
        console.log(`    UID: ${u.uid}`);
        console.log(`    Email: ${u.email}`);
        console.log(`    Providers: ${u.providers}`);
        console.log(`    Email Verified: ${u.emailVerified}`);
        console.log(`    Disabled: ${u.disabled}`);
        console.log(`    Created: ${u.createdAt}`);
        console.log(`    Last Sign In: ${u.lastSignInTime}`);
      });
    }

  } catch (err) {
    console.error('Error listing Firebase users:', err.message || err);
    process.exitCode = 1;
  }
}

main();
