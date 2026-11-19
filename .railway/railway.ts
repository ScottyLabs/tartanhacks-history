import { defineRailway, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("web", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    healthcheck: "/health",
    env: {
      NODE_ENV: "production",
    },
  });

  return project("tartanhacks-history", {
    resources: [web],
  });
});
