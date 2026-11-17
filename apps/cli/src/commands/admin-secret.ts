import { createInterface } from "node:readline/promises";

export async function askAdminSecret(): Promise<string> {
  const fromEnv = process.env.VAULTSYNC_ADMIN_SECRET;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Admin secret: ");
  rl.close();
  return answer.trim();
}
