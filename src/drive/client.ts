import { google } from "googleapis";
import { env } from "../config/env.js";

export const createDriveClient = () => {
  const auth = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });

  return google.drive({ version: "v3", auth });
};
