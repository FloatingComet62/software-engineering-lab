import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  database: new Database("./auth.db"),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [process.env.FRONTEND_URL ?? "http://localhost:3000"],
});
