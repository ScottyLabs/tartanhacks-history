import { defineRailway, github, project, service } from "railway/iac";

// This branch owns only one archive. The other years are separate services.
const year = "2027";
export const partial = year;

export default defineRailway(() => {
  const site = service(year, {
    source: github("ScottyLabs/tartanhacks-history", { branch: year }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/health",
    domains: [`${year}.tartanhacks.com`],
    deploy: {
      sleepApplication: true,
    },
  });

  return project("TartanHacks-History", {
    resources: [site],
  });
});
