import { defineRailway, project, service } from 'railway/iac';

export const partial = 'acha-api';

export default defineRailway(() =>
  project('ACHA', {
    variables: { managed: false },
    resources: [
      service('acha-api', {
        healthcheck: '/api/v1/health',
        healthcheckTimeout: 120,
        preDeploy: null,
      }),
    ],
  }),
);
