import { defineRailway, github, preserve, project, service } from "railway/iac";

// This branch owns only one archive. The other years are separate services.
const year = "2027";
export const partial = year;

export default defineRailway(() => {
  const site = service(year, {
    source: github("ScottyLabs/tartanhacks-history", { branch: year }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.site",
    },
    healthcheck: "/health",
    domains: [`${year}.tartanhacks.com`],
    deploy: {
      sleepApplication: true,
    },
  });

  const sponsors = service(`${year}-sponsors`, {
    source: github("ScottyLabs/tartanhacks-history", { branch: year }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.cron",
    },
    deploy: {
      cronSchedule: "0 5 * * *",
      restartPolicyType: "NEVER",
      startCommand: "bun /app/sync-sponsors.ts",
    },
    env: {
      GOOGLE_CLIENT_EMAIL: preserve(),
      GOOGLE_PRIVATE_KEY: preserve(),
      DRIVE_FOLDER_ID: preserve(),
      SPONSORS_GITHUB_TOKEN: preserve(),
    },
  });

  return project("TartanHacks-History", {
    resources: [site, sponsors],
  });
});
