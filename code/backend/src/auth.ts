import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { config } from "./lib/config";

export const auth = betterAuth({
  database: new Database("./auth.db"),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: config.frontendUrls,
});
