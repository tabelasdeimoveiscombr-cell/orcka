import { google } from "googleapis";
import { env } from "../config/env.js";

export const createDriveClient = () => {
  const auth = new google.auth.GoogleAuth({
    credentials: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
};