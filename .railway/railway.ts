import { defineRailway, github, project, service } from "railway/iac";

// This branch owns only the 2027 archive. The other years are separate services.
export const partial = "2027";

export default defineRailway(() => {
  const site = service("2027", {
    source: github("ScottyLabs/tartanhacks-history", { branch: "2027" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/health",
    domains: ["2027.tartanhacks.com"],
    deploy: {
      sleepApplication: true,
    },
  });

  return project("TartanHacks-History", {
    resources: [site],
  });
});
